import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface SubscriptionsAttributes {
  id:     string;
  userId: string;
  plan: "user" |"pro_user";
  videosUsed: number,
  videosQuota: number,
  renewed_at: Date,
  expiresAt: Date
}

export interface SubscriptionsCreationAttributes extends Optional<ProjectAttributes, 'id' | 'status'> {}

export class Subscriptions
  extends Model<SubscriptionsAttributes, SubscriptionsCreationAttributes>
  implements SubscriptionsAttributes
{
  declare id:     string;
  declare userId: string;
  declare plan: string;
  declare videosUsed: number;
  declare videosQuota: number;
  declare renewed_at: Date;
  declare expiresAt: Date;
}

Subscriptions.init(
  {
    id: {
      type:         DataTypes.UUID,
      allowNull:    false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey:   true,
    },
    userId: {
      type:      DataTypes.UUID,
      allowNull: false,
    },
    plan: {
      type:      DataTypes.ENUM('user', 'pro_user'),
      defaultValue: 'user'
    },
    videosUsed: {
      type:      DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    videosQuota: {
      type:       DataTypes.INTEGER,
      allowNull:    false
    },
    renewed_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    expiresAt: {
        type: DataTypes.DATE,
        defaultValue
    }
  },
  {
    sequelize,
    tableName:  "projects",
    timestamps: true,
  },
);