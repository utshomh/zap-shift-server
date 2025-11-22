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

app.post("/parcels", async (req, res) => {
  const parcel = req.body;
  const insertedParcel = await parcelsCollection.insertOne(parcel);
  res.status(201).json(insertedParcel);
});

app.all(/.*/, (_req, res) => {
  res.status(404).json({
    message: "Route Not Found",
  });
});
