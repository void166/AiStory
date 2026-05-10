import type { ModelStatic, Model } from "sequelize";
import { User }          from "./User";
import { Project }       from "./Project";
import { Video }         from "./Video";
import { Scene }         from "./Scenes";
import { Subscriptions } from "./Subscriptions";

// Cast to ModelStatic<Model> so TypeScript resolves the static association
// methods (hasMany / belongsTo) regardless of the concrete attribute types.
const UserModel          = User          as unknown as ModelStatic<Model>;
const ProjectModel       = Project       as unknown as ModelStatic<Model>;
const VideoModel         = Video         as unknown as ModelStatic<Model>;
const SceneModel         = Scene         as unknown as ModelStatic<Model>;
const SubscriptionModel  = Subscriptions as unknown as ModelStatic<Model>;

export const associations = () => {
  // User → Projects
  UserModel.hasMany(ProjectModel, { foreignKey: "userId", onDelete: "CASCADE" });
  ProjectModel.belongsTo(UserModel, { foreignKey: "userId" });

  // Project → Videos
  ProjectModel.hasMany(VideoModel, { foreignKey: "projectId", onDelete: "CASCADE" });
  VideoModel.belongsTo(ProjectModel, { foreignKey: "projectId" });

  // User → Videos (direct shortcut)
  UserModel.hasMany(VideoModel, { foreignKey: "userId", onDelete: "CASCADE" });
  VideoModel.belongsTo(UserModel, { foreignKey: "userId" });

  // Video → Scenes
  VideoModel.hasMany(SceneModel, { foreignKey: "videoId", onDelete: "CASCADE" });
  SceneModel.belongsTo(VideoModel, { foreignKey: "videoId" });

  // User → Subscription (1:1)
  UserModel.hasOne(SubscriptionModel, { foreignKey: "userId", onDelete: "CASCADE" });
  SubscriptionModel.belongsTo(UserModel, { foreignKey: "userId" });
};
