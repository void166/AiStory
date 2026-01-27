import express from "express";
import type { Request, Response } from "express";
import { associations } from "./model/Associations";
import sequelize from "./config/db";
import authRouter from "./routes/authRoutes";

const app = express();

app.use(express.json());


app.use('/api/auth',authRouter);

(async ()=>{
  try{
    associations();
    await sequelize.authenticate();
    console.log("db connected")
    await sequelize.sync({alter: true});
    console.log("db synced dude");
    
  }catch(err){
    console.log("database connection error: ", err);
  }
})();

app.get("/", (req: Request, res: Response) => {
  res.send("Server working");
});

app.listen(4900, () => {
  console.log("Server running on port 4900");
});
