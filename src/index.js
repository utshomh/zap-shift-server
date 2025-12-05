import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import Stripe from "stripe";

import admin from "./admin.js";
import { generateTrackingId } from "./utils.js";

// Configs
const app = express();

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });
const port = process.env.PORT;
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

client
  .connect()
  .then(() => {
    app.listen(port, () => {
      console.log(`[server] listening on port ${port}`);
      console.log(`[server] connected to db`);
    });
  })
  .catch((err) => {
    console.log(err);
  });

const database = client.db("zap-shift");
const usersCollection = database.collection("users");
const ridersCollection = database.collection("riders");
const parcelsCollection = database.collection("parcels");
const paymentsCollection = database.collection("payments");

const stripe = new Stripe(process.env.STRIPE_SECRET);

// Middlewares
const verifyFirebaseToken = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).json({ message: "Unauthorized Access" });
  }

  try {
    const token = authorization.split(" ")[1];
    const { email } = await admin.auth().verifyIdToken(token);
    req.headers.email = email;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized Access" });
  }
};

app.use(cors());
app.use(express.json());

app.use(async (req, _res, next) => {
  console.log(
    `[⌛ ${new Date().toLocaleString()} (from ${req.host})]
     ⚡ ${req.method} at ${req.path}`
  );
  next();
});

// General Routes
app.get("/", (_req, res) => {
  res.json({ message: "Welcome to Zap Shift API" });
});

// User Routes
app.post("/users", async (req, res) => {
  try {
    const user = { ...req.body, role: "user", createdAt: new Date() };
    const existingUser = await usersCollection.findOne({ email: user.email });
    if (!existingUser) {
      const createdUser = await usersCollection.insertOne(user);
      res.status(201).json(createdUser);
    } else {
      res.status(200).send();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rider Routes
app.get("/riders", verifyFirebaseToken, async (req, res) => {
  try {
    const allowedFields = ["status"];
    const query = {};

    for (const key of allowedFields) {
      if (req.query[key]) {
        query[key] = req.query[key];
      }
    }

    const sortField = req.query.sort || "createdAt";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    const riders = await ridersCollection
      .find(query)
      .sort({ [sortField]: sortOrder })
      .toArray();
    res.json(riders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/riders", async (req, res) => {
  try {
    const rider = { ...req.body, status: "pending", createdAt: new Date() };
    const existingRider = await ridersCollection.findOne({
      email: rider.email,
    });
    if (existingRider) {
      res.status(409).json({
        message: "A rider with this email already exists",
      });
    } else {
      const createdRider = await ridersCollection.insertOne(rider);
      res.status(201).json(createdRider);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/riders/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const update = { $set: { ...req.body } };
    const filter = { _id: new ObjectId(id) };

    const rider = await ridersCollection.findOne(filter);
    const updatedRider = await ridersCollection.updateOne(filter, update);

    if (updatedRider.modifiedCount === 0) {
      return res.status(404).json({ message: "Rider not found" });
    }

    if (req.body.status === "approved") {
      const riderEmail = rider.email;
      const updatedUser = await usersCollection.updateOne(
        { email: riderEmail },
        { $set: { role: "rider" } }
      );
    }

    res.json(updatedRider.value);
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: err.message });
  }
});

app.delete("/riders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const filter = { _id: new ObjectId(id) };
    const deletionResult = await ridersCollection.deleteOne(filter);

    if (deletionResult.deletedCount === 1) {
      res.json(deletionResult);
    } else {
      res.status(404).json({ message: "Parcel Not Found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment Routes
app.get("/payments", verifyFirebaseToken, async (req, res) => {
  try {
    const allowedFields = ["customerEmail"];
    const query = {};

    for (const key of allowedFields) {
      if (req.query[key]) {
        query[key] = req.query[key];
      }
    }

    const sortField = req.query.sort || "createdAt";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    if (query.customerEmail !== req.headers.email) {
      return res.status(403).json({ message: "Forbidden Access" });
    }

    const payments = await paymentsCollection
      .find(query)
      .sort({ [sortField]: sortOrder })
      .toArray();

    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/payments", async (req, res) => {
  try {
    const parcel = req.body;
    const bdtAmount = parcel.charge;
    const usdAmount = Math.ceil(bdtAmount / 110);
    const amount = usdAmount * 100;
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amount,
            product_data: {
              name: parcel.parcelName,
            },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      metadata: {
        parcelId: parcel._id,
        parcelName: parcel.parcelName,
      },
      customer_email: parcel.senderEmail,
      success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?sessionId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    });
    console.log(session);
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/payments", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === "paid";
    const trackingId = generateTrackingId();

    const payment = {
      amount: session.amount_total / 100,
      currency: session.currency,
      customerEmail: session.customer_email,
      parcelId: session.metadata.parcelId,
      parcelName: session.metadata.parcelName,
      paymentStatus: session.payment_status,
      paidAt: new Date(),
      transactionId: session.payment_intent,
      trackingId,
    };

    const filter = { parcelId: session.metadata.parcelId };
    const existingPayment = await paymentsCollection.findOne(filter);

    if (existingPayment) {
      return res.json(existingPayment);
    }

    if (paid) {
      const filter = { _id: new ObjectId(session.metadata.parcelId) };
      const update = {
        $set: {
          paymentStatus: "paid",
          trackingId,
        },
      };
      await parcelsCollection.updateOne(filter, update);
      await paymentsCollection.insertOne({
        ...payment,
      });
      return res.json(payment);
    }

    res.json({ success: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parcel Routes
app.get("/parcels", verifyFirebaseToken, async (req, res) => {
  try {
    const allowedFields = ["senderEmail"];
    const query = {};

    for (const key of allowedFields) {
      if (req.query[key]) {
        query[key] = req.query[key];
      }
    }

    const sortField = req.query.sort || "createdAt";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    if (query.senderEmail !== req.headers.email) {
      return res.status(403).json({ message: "Forbidden Access" });
    }

    const parcels = await parcelsCollection
      .find(query)
      .sort({ [sortField]: sortOrder })
      .toArray();

    res.json(parcels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/parcels/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const parcel = await parcelsCollection.findOne(query);
    if (parcel) {
      res.json(parcel);
    } else {
      res.status(404).json({ message: "Parcel Not Found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/parcels", async (req, res) => {
  try {
    const parcel = req.body;
    const insertedParcel = await parcelsCollection.insertOne({
      ...parcel,
      createdAt: new Date(),
    });
    res.status(201).json(insertedParcel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/parcels/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const filter = { _id: new ObjectId(id) };
    const deletionResult = await parcelsCollection.deleteOne(filter);

    if (deletionResult.deletedCount === 1) {
      res.json(deletionResult);
    } else {
      res.status(404).json({ message: "Parcel Not Found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error Routes
app.all(/.*/, (_req, res) => {
  res.status(404).json({
    message: "Route Not Found",
  });
});
