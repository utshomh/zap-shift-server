import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";

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

// API Routes
app.get("/", (_req, res) => {
  res.json({ message: "Welcome to Zap Shift API" });
});

app.get("/parcels", async (req, res) => {
  try {
    const allowedFields = ["email"];
    const query = {};

    for (const key of allowedFields) {
      if (req.query[key]) {
        query[key] = req.query[key];
      }
    }

    // Sorting support
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

app.all(/.*/, (_req, res) => {
  res.status(404).json({
    message: "Route Not Found",
  });
});
