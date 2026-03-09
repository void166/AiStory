// test-video-generation.ts
// Энэ файлыг ажиллуулж video generation тест хийнэ

import videoService from './videoService';

async function testVideoGeneration() {
  try {
    console.log('🧪 Testing video generation...\n');

    const result = await videoService.generateVideos(
      'Монголын алслагдсан нууцлаг газар дахь аймшигт явдал', // Topic
      {
        duration: 30,           // 30 секунд
        genre: 'horror',        // Аймшигт түүх
        language: 'mongolian',  // Монгол хэл
        imageStyle: 'anime',    // Anime стиль
        voiceId: 'JBFqnCBsd6RMkjVDRZzb'       // Эрэгтэй дуу
      }
    );

    console.log('\n✨ Video generation completed!');
    console.log('\n📊 Result:');
    console.log(JSON.stringify({
      videoId: result.videoId,
      title: result.title,
      duration: result.duration,
      scenes: result.scenes.length,
      videoPath: result.videoPath,
      status: result.status
    }, null, 2));

    console.log(`\n🎥 Video saved to: ${result.videoPath}`);
    console.log(`\n✅ You can now play the video!`);

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
  }
}

// Run test
testVideoGeneration();