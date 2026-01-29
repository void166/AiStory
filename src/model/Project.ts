import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface ProjectAttributes{
    id: string;
    userId: string;
    title: string;
    topic: string;
    status: 'draft' | 'processing' | 'completed' | 'failed';
}

export interface ProjectCreationAttributes extends Optional<ProjectAttributes,
  'id' | 'status' 
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
    status: {
        type: DataTypes.ENUM('draft', 'processing', 'completed', 'failed'),
        defaultValue: 'draft'
    }
},{
    sequelize,
    tableName: "project",
    timestamps: true
})