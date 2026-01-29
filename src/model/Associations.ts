import { User } from "./User";
import { Project } from "./Project";
import { Video } from "./Video";


export const associations = () => {
    User.hasMany(Project, { foreignKey: "userId" });
    Project.belongsTo(User, { foreignKey: "userId" });
  
    Project.hasMany(Video, { foreignKey: "projectId" });
    Video.belongsTo(Project, { foreignKey: "projectId" });
  };