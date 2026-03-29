import express from "express";
import type { Request, Response } from "express";
import path from "path";
import { associations } from "./model/Associations";
import sequelize from "./config/db";
import authRouter from "./routes/authRoutes";
import projectRouter from "./routes/projectRoutes";
import aiImageRoutes from './routes/aiImageRoutes'
import scriptRoutes from './routes/scriptRoutes'
import audioRoute from './routes/audioRoute'
import videoRoute from './routes/videoRoutes'


const app = express();

app.use(express.json());

app.use('/output', express.static(path.join(process.cwd(), 'output')));


app.use('/api/auth',authRouter);
app.use("/api",projectRouter);
app.use('/api', scriptRoutes);
app.use("/api/ai/image", aiImageRoutes);
app.use("/api/ai/script", scriptRoutes);
app.use('/api/audio', audioRoute);
app.use('/api/video', videoRoute);


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
