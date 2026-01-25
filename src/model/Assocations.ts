import { User } from "./User";
import { Asset } from "./Asset";
import { Project } from "./Project";
import { Template } from "./Template";
import { Video } from "./Video";


export const associations = ()=>{

    User.hasMany(Project, {foreignKey: "userId"});
    Project.belongsTo(User, {foreignKey: "userId"});

    Project.hasMany(Video, {foreignKey: "projectId"});
    Video.belongsTo(Project, {foreignKey: "projectId"});

    Project.hasMany(Asset, {foreignKey: "projectId"});
    Asset.belongsTo(Project, {foreignKey: "projectId"});
    
    Template.hasMany(Project, {foreignKey: "projectId"})
    Project.belongsTo(Template, {foreignKey: "projectId"})

}