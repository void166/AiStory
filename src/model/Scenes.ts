import { DataTypes, Model, type Optional } from "sequelize";
import sequelize from "../config/db";

interface SceneAttributes {
  id:             string;
  videoId:        string;        
  sceneIndex:     number;        
  time:           string;        
  scene:          string;        
  narration:      string | null; 
  imagePrompt:    string | null; 
  imageUrl:       string | null; 
  audioUrl:       string | null; 
  audioDuration:  number | null; 
  words:          string | null; 
  transitionType: string | null; 
  motionEffect:   string | null; 
}

interface SceneCreationAttributes extends Optional<SceneAttributes, "id"> {}

export class Scene
  extends Model<SceneAttributes, SceneCreationAttributes>
  implements SceneAttributes
{
  declare id:             string;
  declare videoId:        string;
  declare sceneIndex:     number;
  declare time:           string;
  declare scene:          string;
  declare narration:      string | null;
  declare imagePrompt:    string | null;
  declare imageUrl:       string | null;
  declare audioUrl:       string | null;
  declare audioDuration:  number | null;
  declare words:          string | null;
  declare transitionType: string | null;
  declare motionEffect:   string | null;
}

Scene.init(
  {
    id: {
      type:         DataTypes.UUID,
      allowNull:    false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey:   true,
    },
    videoId: {
      type:      DataTypes.UUID,
      allowNull: false,
    },
    sceneIndex: {
      type:      DataTypes.INTEGER,
      allowNull: false,
    },
    time: {
      type:      DataTypes.STRING(50),
      allowNull: false,
    },
    scene: {
      type:      DataTypes.STRING(200),
      allowNull: false,
    },
    narration: {
      type:      DataTypes.TEXT,
      allowNull: true,
    },
    imagePrompt: {
      type:      DataTypes.TEXT,
      allowNull: true,
    },
    imageUrl: {
      type:      DataTypes.TEXT,
      allowNull: true,
    },
    audioUrl: {
      type:      DataTypes.TEXT,
      allowNull: true,
    },
    audioDuration: {
      type:      DataTypes.FLOAT,
      allowNull: true,
    },
    words: {
      type:      DataTypes.TEXT, 
      allowNull: true,
    },
    transitionType: {
      type:      DataTypes.STRING(50),
      allowNull: true,
    },
    motionEffect: {
      type:      DataTypes.STRING(50),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName:  "scenes",
    timestamps: true,
  },
);
