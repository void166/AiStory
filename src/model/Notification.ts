import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

/**
 * In-app notification — shown in the bell-icon dropdown on the frontend.
 *
 *  `type`     — drives the icon / accent colour on the UI.
 *  `link`     — relative path the bell row navigates to when clicked
 *               (e.g. `/studio?videoId=...` or `/projects`).
 *  `data`     — free-form JSON payload (thumbnail URL, videoId, etc.) so
 *               the frontend can render rich rows without an extra fetch.
 *  `isRead`   — flips to true the moment the user opens the dropdown OR
 *               clicks the row.
 */
export type NotificationType =
  | "video_completed"
  | "video_failed"
  | "pdf_processed"
  | "system";

interface NotificationAttributes {
  id:        string;
  userId:    string;
  type:      NotificationType;
  title:     string;
  message:   string;
  link:      string | null;
  data:      Record<string, unknown> | null;
  isRead:    boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface NotificationCreationAttributes
  extends Optional<NotificationAttributes, "id" | "isRead" | "link" | "data"> {}

export class Notification
  extends Model<NotificationAttributes, NotificationCreationAttributes>
  implements NotificationAttributes
{
  declare id:      string;
  declare userId:  string;
  declare type:    NotificationType;
  declare title:   string;
  declare message: string;
  declare link:    string | null;
  declare data:    Record<string, unknown> | null;
  declare isRead:  boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Notification.init(
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
    type: {
      type:         DataTypes.ENUM("video_completed", "video_failed", "pdf_processed", "system"),
      allowNull:    false,
      defaultValue: "system",
    },
    title: {
      type:      DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type:      DataTypes.TEXT,
      allowNull: false,
    },
    link: {
      type:      DataTypes.STRING,
      allowNull: true,
    },
    data: {
      type:      DataTypes.JSONB,
      allowNull: true,
    },
    isRead: {
      type:         DataTypes.BOOLEAN,
      allowNull:    false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName:  "notifications",
    timestamps: true,
    indexes: [
      // Most frequent query is "the user's recent unread notifications"
      // — sorted DESC by createdAt. A composite index covers it cleanly.
      { fields: ["userId", "isRead", "createdAt"] },
    ],
  },
);
