ai-video-generator/
│
├── backend/                          # Node.js Backend
│   ├── src/
│   │   ├── config/                   # Configuration files
│   │   │   ├── database.js           # DB config
│   │   │   ├── redis.js              # Redis config
│   │   │   ├── s3.js                 # S3/MinIO config
│   │   │   └── apis.js               # External API configs
│   │   │
│   │   ├── models/                   # Database models
│   │   │   ├── User.js
│   │   │   ├── Project.js            # Video projects
│   │   │   ├── Video.js              # Generated videos
│   │   │   ├── Asset.js              # Images, audio files
│   │   │   └── Template.js           # Video templates
│   │   │
│   │   ├── routes/                   # API routes
│   │   │   ├── auth.routes.js        # POST /auth/login, /register
│   │   │   ├── project.routes.js     # CRUD projects
│   │   │   ├── video.routes.js       # Video generation
│   │   │   ├── asset.routes.js       # Asset management
│   │   │   └── template.routes.js    # Template management
│   │   │
│   │   ├── controllers/              # Business logic
│   │   │   ├── authController.js
│   │   │   ├── projectController.js
│   │   │   ├── videoController.js
│   │   │   └── assetController.js
│   │   │
│   │   ├── services/                 # Core business services
│   │   │   ├── ai/
│   │   │   │   ├── imageGeneration.service.js    # DALL-E, Stable Diffusion
│   │   │   │   ├── audioGeneration.service.js    # Chimege.sub, ElevenLabs
│   │   │   │   ├── scriptGeneration.service.js   # Claude/GPT script
│   │   │   │   └── imageAnalysis.service.js      # Gemini image analysis
│   │   │   │
│   │   │   ├── video/
│   │   │   │   ├── composition.service.js        # Remotion orchestration
│   │   │   │   ├── rendering.service.js          # Video rendering
│   │   │   │   └── postProcessing.service.js     # FFmpeg processing
│   │   │   │
│   │   │   ├── storage/
│   │   │   │   ├── s3.service.js                 # S3/MinIO uploads
│   │   │   │   └── cdn.service.js                # CDN integration
│   │   │   │
│   │   │   └── notification.service.js           # Email, WebSocket notifications
│   │   │
│   │   ├── workers/                  # Background job workers
│   │   │   ├── videoGenerationWorker.js   # Main video generation
│   │   │   ├── imageGenWorker.js          # Batch image generation
│   │   │   ├── audioGenWorker.js          # Audio generation
│   │   │   └── cleanupWorker.js           # Delete old files
│   │   │
│   │   ├── middleware/               # Express middleware
│   │   │   ├── auth.middleware.js    # JWT verification
│   │   │   ├── validation.middleware.js  # Request validation
│   │   │   ├── rateLimit.middleware.js   # Rate limiting
│   │   │   └── error.middleware.js   # Error handling
│   │   │
│   │   ├── utils/                    # Utility functions
│   │   │   ├── logger.js             # Winston logger
│   │   │   ├── validation.js         # Joi schemas
│   │   │   └── helpers.js            # Common helpers
│   │   │
│   │   ├── queues/                   # BullMQ queues
│   │   │   ├── videoQueue.js
│   │   │   ├── imageQueue.js
│   │   │   └── audioQueue.js
│   │   │
│   │   ├── websocket/                # Real-time updates
│   │   │   └── videoProgress.js      # Progress notifications
│   │   │
│   │   └── app.js                    # Express app setup
│   │
│   ├── remotion/                     # Remotion video templates
│   │   ├── src/
│   │   │   ├── Video.jsx             # Main composition
│   │   │   ├── components/
│   │   │   │   ├── Scene.jsx
│   │   │   │   ├── Transition.jsx
│   │   │   │   ├── Caption.jsx
│   │   │   │   └── Background.jsx
│   │   │   │
│   │   │   ├── templates/
│   │   │   │   ├── SocialMediaTemplate.jsx
│   │   │   │   ├── EducationalTemplate.jsx
│   │   │   │   └── StoryTemplate.jsx
│   │   │   │
│   │   │   └── Root.jsx
│   │   │
│   │   ├── public/
│   │   └── remotion.config.js
│   │
│   ├── tests/                        # Tests
│   │   ├── unit/
│   │   ├── integration/
│   │   └── e2e/
│   │
│   ├── .env.example
│   ├── .env
│   ├── package.json
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── frontend/                         # React Frontend
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx
│   │   │   ├── CreateProject.jsx
│   │   │   ├── VideoEditor.jsx
│   │   │   └── Dashboard.jsx
│   │   │
│   │   ├── components/
│   │   │   ├── VideoPlayer.jsx
│   │   │   ├── ProgressBar.jsx
│   │   │   ├── AssetLibrary.jsx
│   │   │   └── TemplateGallery.jsx
│   │   │
│   │   ├── services/
│   │   │   └── api.js                # Axios instance
│   │   │
│   │   └── App.jsx
│   │
│   └── package.json
│
└── docs/                             # Documentation
    ├── API.md
    ├── ARCHITECTURE.md
    └── DEPLOYMENT.md