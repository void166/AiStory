// controllers/scriptController.ts
import { Request, Response } from 'express';
import scriptService from '../services/ai/scriptService';

export class ScriptController {
  /**
   * 📝 Generate new script
   * POST /api/script/generate
   */
  async generateScript(req: Request, res: Response) {
    try {
      const { topic, duration, genre, language, imageStyle } = req.body;


      if (!topic || topic.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Topic is required'
        });
      }

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📝 GENERATING SCRIPT');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Topic: ${topic}`);
      console.log(`Duration: ${duration || 60}s`);
      console.log(`Genre: ${genre || 'horror'}`);
      console.log(`Language: ${language || 'mongolian'}`);
      console.log(`imageStyle: ${imageStyle || 'anime'}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Generate script
      const script = await scriptService.generate(
        topic,
        imageStyle || 'anime',
         {
        duration: duration || 60,
        genre: genre || 'horror',
        language: language || 'mongolian',
      });

      console.log('\n✅ SCRIPT GENERATED SUCCESSFULLY!');
      console.log(`   Title: ${script.title}`);
      console.log(`   Scenes: ${script.script.length}`);
      console.log(`   Duration: ${script.duration}s`);
      console.log(`   Background Images: ${script.backgroundImages.length}`);

      // Log each scene
      console.log('\n📋 SCENES:');
      script.script.forEach((scene, i) => {
        console.log(`\n   Scene ${i + 1}:`);
        console.log(`   ├─ Time: ${scene.time}`);
        console.log(`   ├─ Title: ${scene.scene}`);
        console.log(`   ├─ Visual: ${scene.visual?.substring(0, 60)}...`);
        console.log(`   └─ Narration: ${scene.narration?.substring(0, 60)}...`);
      });

      return res.status(200).json({
        success: true,
        message: 'Script generated successfully',
        data: script
      });

    } catch (error: any) {
      console.error('\n❌ SCRIPT GENERATION ERROR:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to generate script',
        error: error.message
      });
    }
  }

  /**
   * 🔄 Regenerate specific scene
   * POST /api/script/regenerate-scene
   */
  async regenerateScene(req: Request, res: Response) {
    try {
      const { script, sceneIndex, customPrompt } = req.body;

      // Validation
      if (!script || !script.script || !Array.isArray(script.script)) {
        return res.status(400).json({
          success: false,
          message: 'Valid script is required'
        });
      }

      if (sceneIndex === undefined || sceneIndex < 0 || sceneIndex >= script.script.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid sceneIndex. Must be between 0 and ${script.script.length - 1}`
        });
      }

      console.log(`\n🔄 Regenerating scene ${sceneIndex + 1}...`);
      console.log(`   Original: ${script.script[sceneIndex].scene}`);

      // Regenerate scene
      const newScene = await scriptService.regenerateScene(
        script,
        sceneIndex,
        customPrompt
      );

      console.log(`\n✅ Scene regenerated!`);
      console.log(`   New: ${newScene.scene}`);

      // Update script with new scene
      const updatedScript = {
        ...script,
        script: script.script.map((s: any, i: number) => 
          i === sceneIndex ? newScene : s
        )
      };

      return res.status(200).json({
        success: true,
        message: 'Scene regenerated successfully',
        data: {
          updatedScript,
          regeneratedScene: newScene,
          sceneIndex
        }
      });

    } catch (error: any) {
      console.error('\n❌ SCENE REGENERATION ERROR:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to regenerate scene',
        error: error.message
      });
    }
  }

  /**
   * ✏️ Edit specific scene manually
   * POST /api/script/edit-scene
   */
  async editScene(req: Request, res: Response) {
    try {
      const { script, sceneIndex, updates } = req.body;

      // Validation
      if (!script || !script.script || !Array.isArray(script.script)) {
        return res.status(400).json({
          success: false,
          message: 'Valid script is required'
        });
      }

      if (sceneIndex === undefined || sceneIndex < 0 || sceneIndex >= script.script.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid sceneIndex. Must be between 0 and ${script.script.length - 1}`
        });
      }

      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'Updates object is required'
        });
      }

      console.log(`\n✏️ Editing scene ${sceneIndex + 1}...`);

      // Update scene
      const updatedScene = {
        ...script.script[sceneIndex],
        ...updates
      };

      const updatedScript = {
        ...script,
        script: script.script.map((s: any, i: number) => 
          i === sceneIndex ? updatedScene : s
        )
      };

      console.log(`✅ Scene edited successfully!`);

      return res.status(200).json({
        success: true,
        message: 'Scene edited successfully',
        data: {
          updatedScript,
          editedScene: updatedScene,
          sceneIndex
        }
      });

    } catch (error: any) {
      console.error('\n❌ SCENE EDIT ERROR:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to edit scene',
        error: error.message
      });
    }
  }

  /**
   * ➕ Add new scene
   * POST /api/script/add-scene
   */
  async addScene(req: Request, res: Response) {
    try {
      const { script, newScene, insertAtIndex } = req.body;

      // Validation
      if (!script || !script.script || !Array.isArray(script.script)) {
        return res.status(400).json({
          success: false,
          message: 'Valid script is required'
        });
      }

      if (!newScene || !newScene.time || !newScene.scene || !newScene.visual || !newScene.narration) {
        return res.status(400).json({
          success: false,
          message: 'New scene must have: time, scene, visual, narration'
        });
      }

      const index = insertAtIndex !== undefined ? insertAtIndex : script.script.length;

      console.log(`\n➕ Adding new scene at position ${index + 1}...`);

      // Insert scene
      const updatedScenes = [...script.script];
      updatedScenes.splice(index, 0, newScene);

      const updatedScript = {
        ...script,
        script: updatedScenes
      };

      console.log(`✅ Scene added successfully!`);

      return res.status(200).json({
        success: true,
        message: 'Scene added successfully',
        data: {
          updatedScript,
          addedScene: newScene,
          insertedAt: index
        }
      });

    } catch (error: any) {
      console.error('\n❌ ADD SCENE ERROR:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to add scene',
        error: error.message
      });
    }
  }

  /**
   * 🗑️ Delete scene
   * POST /api/script/delete-scene
   */
  async deleteScene(req: Request, res: Response) {
    try {
      const { script, sceneIndex } = req.body;

      // Validation
      if (!script || !script.script || !Array.isArray(script.script)) {
        return res.status(400).json({
          success: false,
          message: 'Valid script is required'
        });
      }

      if (sceneIndex === undefined || sceneIndex < 0 || sceneIndex >= script.script.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid sceneIndex. Must be between 0 and ${script.script.length - 1}`
        });
      }

      if (script.script.length <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the last scene. Script must have at least one scene.'
        });
      }

      console.log(`\n🗑️ Deleting scene ${sceneIndex + 1}...`);

      const deletedScene = script.script[sceneIndex];

      // Remove scene
      const updatedScript = {
        ...script,
        script: script.script.filter((_: any, i: number) => i !== sceneIndex)
      };

      console.log(`✅ Scene deleted successfully!`);

      return res.status(200).json({
        success: true,
        message: 'Scene deleted successfully',
        data: {
          updatedScript,
          deletedScene,
          deletedIndex: sceneIndex
        }
      });

    } catch (error: any) {
      console.error('\n❌ DELETE SCENE ERROR:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to delete scene',
        error: error.message
      });
    }
  }

  /**
   * 📊 Validate script timing
   * POST /api/script/validate-timing
   */
  async validateTiming(req: Request, res: Response) {
    try {
      const { script } = req.body;

      if (!script || !script.script || !Array.isArray(script.script)) {
        return res.status(400).json({
          success: false,
          message: 'Valid script is required'
        });
      }

      const issues: string[] = [];
      let previousEnd = 0;

      script.script.forEach((scene: any, index: number) => {
        if (!scene.time) {
          issues.push(`Scene ${index + 1}: Missing time field`);
          return;
        }

        const [start, end] = scene.time.split('-').map(Number);

        if (isNaN(start) || isNaN(end)) {
          issues.push(`Scene ${index + 1}: Invalid time format "${scene.time}"`);
          return;
        }

        if (start !== previousEnd) {
          issues.push(`Scene ${index + 1}: Gap or overlap detected (starts at ${start}, should start at ${previousEnd})`);
        }

        if (end <= start) {
          issues.push(`Scene ${index + 1}: End time must be greater than start time`);
        }

        previousEnd = end;
      });

      const isValid = issues.length === 0;
      const totalDuration = previousEnd;

      return res.status(200).json({
        success: true,
        message: isValid ? 'Script timing is valid' : 'Script timing has issues',
        data: {
          isValid,
          totalDuration,
          expectedDuration: script.duration,
          durationMatch: totalDuration.toString() === script.duration,
          issues
        }
      });

    } catch (error: any) {
      console.error('\n❌ VALIDATION ERROR:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to validate script',
        error: error.message
      });
    }
  }
}

export default new ScriptController();