import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db.js";

interface ProjectAttributes{
    id: string;
    name: string;
    userId: string
}

interface ProjectCreationAttributes extends Optional<ProjectAttributes, "id">{}

export class Project extends Model<ProjectAttributes, ProjectCreationAttributes> implements ProjectAttributes{
    declare id: string;
    declare name: string;
    declare userId: string;
}

Project.init({
    id:{
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name:{
        type: DataTypes.STRING,
        allowNull: false
    },
    userId:{
        type: DataTypes.STRING,
        allowNull: false,
    }
},{
    sequelize,
    tableName: "project",
    timestamps: true
})