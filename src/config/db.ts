import { Sequelize } from "sequelize";
import { config } from "./index";

const { DB_HOST, DB_PORT, DB_NAME, DB_PASSWORD, DB_USER } = config;
const isProd = process.env.NODE_ENV === 'production';

const sequelize = new Sequelize({
  dialect: "postgres",
  database: DB_NAME,
  username: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  port: DB_PORT,
  logging: false,
  // Wrap SSL settings in dialectOptions
  dialectOptions: {
    ssl: isProd ? {
      require: true,
      rejectUnauthorized: false // Required for most managed providers like Render/Neon/AWS
    } : false
  }
});

export default sequelize;