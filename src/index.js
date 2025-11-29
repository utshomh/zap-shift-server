import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import Stripe from "stripe";

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

app.use(async (req, _res, next) => {
  console.log(
    `[⌛ ${new Date().toLocaleString()} (from ${req.host})]
     ⚡ ${req.method} at ${req.path}`
  );
  next();
});

// Configs
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
const parcelsCollection = database.collection("parcels");

const stripe = new Stripe(process.env.STRIPE_SECRET);

// General Routes
app.get("/", (_req, res) => {
  res.json({ message: "Welcome to Zap Shift API" });
});

// Payment Routes
app.post("/payment-checkout", async (req, res) => {
  try {
    const parcel = req.body;
    const amount = parcel.charge * 100;
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "bdt",
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
      },
      customer_email: parcel.senderEmail,
      success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?sessionId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/verify-payment", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === "paid";

    if (paid) {
      const filter = { _id: new ObjectId(session.metadata.parcelId) };
      const update = {
        $set: {
          paymentStatus: "paid",
        },
      };
      const updatedParcel = await parcelsCollection.updateOne(filter, update);
      res.json({ paid, ...updatedParcel });
    } else {
      res.json({ paid });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parcel Routes
app.get("/parcels", async (req, res) => {
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
    const insertedParcel = await parcelsCollection.insertOne(parcel);
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
