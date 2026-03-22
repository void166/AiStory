import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface ProjectAttributes{
    id: string;
    userId: string;
    title: string;
    topic: string;
}

export interface ProjectCreationAttributes extends Optional<ProjectAttributes,
  'id' 
> {}

export class Project extends Model<ProjectAttributes, ProjectCreationAttributes> implements ProjectAttributes {
    declare id: string;
    declare userId: string;
    declare title: string;
    declare topic: string;
    declare status: 'draft' | 'processing' | 'completed' | 'failed';
  }

Project.init({
    id:{
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    userId:{
        type: DataTypes.UUID,
        allowNull: false,
    },
    title:{
        type: DataTypes.STRING(200),
        allowNull: false
    },
    topic: {
        type: DataTypes.TEXT,
        allowNull: false
    },
},{
    sequelize,
    tableName: "project",
    timestamps: true
})