import { User }    from "./User";
import { Project } from "./Project";
import { Video }   from "./Video";
import { Scene }   from "./Scenes";

export const associations = () => {
  // User → Projects
  User.hasMany(Project, { foreignKey: "userId", onDelete: "CASCADE" });
  Project.belongsTo(User, { foreignKey: "userId" });

  // Project → Videos
  Project.hasMany(Video, { foreignKey: "projectId", onDelete: "CASCADE" });
  Video.belongsTo(Project, { foreignKey: "projectId" });

  // User → Videos (direct shortcut)
  User.hasMany(Video, { foreignKey: "userId", onDelete: "CASCADE" });
  Video.belongsTo(User, { foreignKey: "userId" });

  // Video → Scenes
  Video.hasMany(Scene, { foreignKey: "videoId", onDelete: "CASCADE" });
  Scene.belongsTo(Video, { foreignKey: "videoId" });
};
