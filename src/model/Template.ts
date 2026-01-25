import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db.js";

interface TemplateAttributes{
    id: string;
    name: string;
    description: string
    config: JSON;
}

interface TemplateCreationAttributes extends Optional<TemplateAttributes, "id">{}

export class Template extends Model<TemplateAttributes, TemplateCreationAttributes> implements TemplateAttributes{
    declare id: string;
    declare name: string;
    declare description: string;
    declare config: JSON;
}

Template.init({
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
    description:{
        type: DataTypes.STRING,
        allowNull: false,
    },
    config:{
        type: DataTypes.JSON,
        allowNull: false
    }
},{
    sequelize,
    tableName: "Template",
    timestamps: true
})