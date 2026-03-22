import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface AdminAttributes {
  id:       string;
  email:    string;
  password: string;
  name:     string;
  role:     "superadmin" | "admin";
}

interface AdminCreationAttributes extends Optional<AdminAttributes, "id"> {}

export class Admin
  extends Model<AdminAttributes, AdminCreationAttributes>
  implements AdminAttributes
{
  declare id:       string;
  declare email:    string;
  declare password: string;
  declare name:     string;
  declare role:     "superadmin" | "admin";
}

Admin.init(
  {
    id: {
      type:         DataTypes.UUID,
      allowNull:    false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey:   true,
    },
    email: {
      type:      DataTypes.STRING,
      allowNull: false,
      unique:    true,
    },
    password: {
      type:      DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type:      DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type:         DataTypes.ENUM("superadmin", "admin"),
      allowNull:    false,
      defaultValue: "admin",
    },
  },
  {
    sequelize,
    tableName:  "admins",
    timestamps: true,
  },
);
