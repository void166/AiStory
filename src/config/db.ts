import { Sequelize } from "sequelize";
import { config } from "./index";

const { DB_HOST, DB_PORT, DB_NAME, DB_PASSWORD, DB_USER } = config;

const sequelize = new Sequelize({
  dialect: "postgres",
  database: DB_NAME,
  username: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  port: DB_PORT,
  ssl: false,
  logging: false,
});


export default sequelize;
