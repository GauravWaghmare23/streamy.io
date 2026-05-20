# 🏗️ YouTube Clone — Senior Staff Backend System Design & Engineering Blueprint

This document represents a complete, production-grade **Product Requirements Document (PRD)**, **System Design Document**, and **Backend Engineering Blueprint** for a modular-monolith YouTube Clone. 

Designed for scalability, zero-downtime clustering, sub-millisecond cache hits, and microservices-ready structure, this blueprint serves as a staff-level roadmap for deployment and architectural reviews.

---

## 🗺️ System Design Topology & Request Lifecycle

```
                           [ CLIENTS (Web / Mobile Apps) ]
                                         │
                                         ▼
                       [ Cloudflare Edge CDN & DDoS Shield ]
                       (Serves static assets, HLS .ts files)
                                         │
                                         ▼ (Dynamic API requests / WebSocket)
                       [ Nginx Reverse Proxy / Load Balancer ]
                       (SSL Termination, Gzip, Connection Upgrade)
                                         │
                                         ├──► [ HTTP API Traffic ] ──► [ PM2 Cluster Node Workers (1-N) ]
                                         │                                │   (Express Application Core)
                                         │                                ├──► Cache Check (Redis Client)
                                         │                                └──► DB Operations (MongoDB Replica Set)
                                         │
                                         └──► [ WebSocket Server ] ◄──► [ Redis Pub/Sub Adapter Bus ]
                                                                               (Syncs Socket.IO instances)
```

### The Request-Response Lifecycle Flow
1. **DNS & Edge Router**: The client requests `/api/v1/videos/feed?page=1`. Cloudflare resolves DNS, applies firewall rules, and routes the request.
2. **NGINX Reverse Proxy**: Nginx intercepts the request over HTTPS, terminates SSL, compresses/gzips outputs, validates request rate limits, and forwards it to the PM2 cluster locally on `http://127.0.0.1:8000`.
3. **PM2 Node.js Worker**: PM2 handles the request using one of its active cluster workers.
4. **Middleware Pipeline**:
   - `loggerMiddleware`: Structured Pino request tracing.
   - `rateLimiterMiddleware`: Connects to Redis via `rate-limit-redis` to verify IP limits.
   - `authMiddleware`: Parses and validates stateless HttpOnly JWTs.
   - `validationMiddleware`: Uses Zod schema parsing to reject dirty payloads before hitting controllers.
5. **Controller Layer**: Parses variables and delegates complex tasks to the Service Layer.
6. **Service Layer**: Implements business rules. Coordinates with `videoCache` (Redis). If it's a cache miss, calls the repository.
7. **Repository Layer**: Interacts with the Mongoose ODM using `.lean()` read preferences to fetch documents from a secondary MongoDB replica node.
8. **Asynchronous Jobs**: In operations like video publishing, the service fires an event (`video.published`) on the `eventBus`. The `notificationService` catches it and schedules background notification pushes using **BullMQ** so the client's HTTP response remains unblocked.

---

## 🗂️ Clean Modular Monolith Structure

Below is the folder-by-folder layout built with the **Controller-Service-Repository Pattern**:

```
src/
├── app.js                         ← Configures Express middleware, security layers, and API routers
├── server.js                      ← Bootstraps HTTP/WebSocket servers, DB hooks, and handles Graceful Shutdown
│
├── config/                        ← Application Bootstrap Configurations
│   ├── env.js                     ← Strong Zod schema runtime validation for environment variables
│   ├── db.js                      ← MongoDB Mongoose client with fine-tuned pooling & replica options
│   ├── redis.js                   ← IORedis wrapper creating robust connection retry limits
│   ├── socket.js                  ← Socket.IO setup utilizing Redis Adapter for cross-process scaling
│   ├── rateLimiter.js             ← Custom Express Rate Limit configurations using Redis session backends
│   ├── cloudinary.js              ← Cloudinary Media SDK initialization settings
│   └── logger.js                  ← Structured high-speed logging using Pino
│
├── modules/                       ← Feature-Bound Self-Contained Domain Modules
│   ├── auth/                      ← Handles Sign-Up, Dual JWT Issuance, Token Blacklists, OTP Reset Logic
│   ├── user/                      ← Manages Profile Customization, Feed Compilations, Security preferences
│   ├── channel/                   ← Controls Channel Creations, Category Filters, Creator Analytics
│   ├── video/                     ← Processes Long-form Videos, HLS metadata compilation, Caching, Views
│   ├── short/                     ← Vertical Short content delivery modules
│   ├── playlist/                  ← Groupings, curation, and user-playlist associations
│   ├── post/                      ← Textual creator community updates and media attachments
│   ├── comment/                   ← Polymorphic, decoupled nested comment engine
│   ├── upload/                    ← Handles local multipart buffer storage to Cloudinary streaming pipelines
│   ├── ai/                        ← Gemini-backed semantic tag generation, text search enhancements
│   └── notification/              ← Real-time push, unread flags, and Socket notification systems
│
├── middleware/                    ← Global Shared Middlewares
│   ├── error.middleware.js        ← Global centralized Express operational error handler
│   ├── logger.middleware.js       ← Structured request logging using Pino-HTTP
│   ├── validate.middleware.js     ← Reusable schema validations using Zod models
│   ├── rateLimiter.middleware.js  ← Router rate limiting
│   └── pagination.middleware.js   ← Normalizes offset-limit pagination requests
│
├── shared/                        ← Universally accessible codebase resources
│   ├── constants/                 ← Centralized Redis Key definitions, Status Codes, Queue names
│   ├── utils/                     ← General utility files: response formatters, async wrappers
│   ├── helpers/                   ← Specific helpers: cryptography, HLS helpers
│   ├── responses/                 ← Custom API response schemas
│   └── errors/                    ← Customized AppError constructors for robust error reporting
│
├── database/                      ← Hard Database Migration and Seed Logic
│   ├── indexes/                   ← Native database indexing blueprints
│   ├── migrations/                ← Schema structure migration scripts
│   └── seeders/                   ← Mass mock database generator for scaling tests
│
├── logs/                          ← Target directories for system PM2/Pino storage
├── docker/                        ← Local and production environment virtual container definitions
├── nginx/                         ← Nginx config files for proxies, compression, and SSL termination
└── tests/                         ← Centralized testing suites
```

---

# 🗄️ Database Design Guide

### The Anti-Pattern of Nested Arrays
Embedding dynamic resources (like comment lists, subscriber IDs, or like lists) directly in core documents (like `Video` or `Channel`) is the most common scaling mistake in MongoDB.
1. **The 16 Megabyte Document Limit**: MongoDB enforces a strict limit of 16MB per single BSON document. A video with 10,000 comments or a channel with 200,000 subscribers will quickly hit this threshold and cause write operations to fail.
2. **Memory Overhead**: Every document read loads the entire array into server RAM. Paginated requests become highly inefficient because the application must slice massive arrays in memory rather than database query pipelines.
3. **Write Locking & Contention**: Updating deeply nested array elements causes massive document write locks, degrading database throughput.

### The Decoupled Schema Strategy
Our solution decouples large relations into separate collections (`likes`, `comments`, `subscriptions`, `histories`, `playlistvideos`), utilizing transactional count increments (`likesCount`, `subscribersCount`) inside standard parent records.

---

# 📝 Production-Grade Mongoose Schemas (12 Collections)

These schemas feature **explicit indices, Zod-ready validations, clean data types, count caching, and polymorphic dynamic relations**.

---

### 1. User Schema (`users`)
```javascript
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
   username: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      index: true
   },
   email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, "Please enter a valid email address"],
      index: true
   },
   password: {
      type: String,
      required: true
   },
   photoUrl: {
      type: String,
      default: ""
   },
   channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      default: null
   },
   refreshToken: {
      type: String,
      default: null
   },
   isVerified: {
      type: Boolean,
      default: false
   }
}, { timestamps: true });

userSchema.index({ email: 1 });

const User = mongoose.model("User", userSchema);
export default User;
```

---

### 2. Channel Schema (`channels`)
```javascript
import mongoose from "mongoose";

const channelSchema = new mongoose.Schema({
   owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true
   },
   name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 50
   },
   description: {
      type: String,
      default: "",
      maxlength: 1000
   },
   avatar: {
      type: String,
      default: ""
   },
   bannerImage: {
      type: String,
      default: ""
   },
   subscribersCount: {
      type: Number,
      default: 0,
      min: 0
   },
   videosCount: {
      type: Number,
      default: 0,
      min: 0
   }
}, { timestamps: true });

// Text Index for Semantic Channel Search
channelSchema.index({ name: "text", description: "text" });

const Channel = mongoose.model("Channel", channelSchema);
export default Channel;
```

---

### 3. Video Schema (`videos`)
```javascript
import mongoose from "mongoose";

const videoSchema = new mongoose.Schema({
   channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true
   },
   title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150
   },
   description: {
      type: String,
      default: "",
      maxlength: 5000
   },
   videoUrl: {
      type: String,
      required: true // Holds adaptive bitrate master playlist URL (.m3u8)
   },
   thumbnail: {
      type: String,
      required: true
   },
   duration: {
      type: Number,
      default: 0,
      min: 0 // In seconds
   },
   tags: [{
      type: String,
      trim: true
   }],
   category: {
      type: String,
      default: "General",
      index: true
   },
   visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
      index: true
   },
   viewsCount: {
      type: Number,
      default: 0,
      min: 0
   },
   likesCount: {
      type: Number,
      default: 0,
      min: 0
   },
   dislikesCount: {
      type: Number,
      default: 0,
      min: 0
   },
   commentsCount: {
      type: Number,
      default: 0,
      min: 0
   }
}, { timestamps: true });

// Text Index for Native Search
videoSchema.index({ title: "text", description: "text", tags: "text" }, { weights: { title: 10, tags: 5, description: 1 } });
videoSchema.index({ channel: 1, createdAt: -1 });
videoSchema.index({ visibility: 1, createdAt: -1 });
videoSchema.index({ viewsCount: -1 });

const Video = mongoose.model("Video", videoSchema);
export default Video;
```

---

### 4. Short Schema (`shorts`)
```javascript
import mongoose from "mongoose";

const shortSchema = new mongoose.Schema({
   channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true
   },
   title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
   },
   shortUrl: {
      type: String,
      required: true
   },
   thumbnail: {
      type: String,
      default: ""
   },
   duration: {
      type: Number,
      default: 0,
      max: 60 // YouTube Shorts maximum limit is 60 seconds
   },
   viewsCount: {
      type: Number,
      default: 0,
      min: 0
   },
   likesCount: {
      type: Number,
      default: 0,
      min: 0
   },
   commentsCount: {
      type: Number,
      default: 0,
      min: 0
   }
}, { timestamps: true });

shortSchema.index({ channel: 1, createdAt: -1 });
shortSchema.index({ viewsCount: -1 });

const Short = mongoose.model("Short", shortSchema);
export default Short;
```

---

### 5. Post Schema (`posts`)
```javascript
import mongoose from "mongoose";

const postSchema = new mongoose.Schema({
   channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true
   },
   content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10000
   },
   image: {
      type: String,
      default: ""
   },
   likesCount: {
      type: Number,
      default: 0,
      min: 0
   },
   commentsCount: {
      type: Number,
      default: 0,
      min: 0
   }
}, { timestamps: true });

postSchema.index({ channel: 1, createdAt: -1 });

const Post = mongoose.model("Post", postSchema);
export default Post;
```

---

### 6. Comment Schema (`comments`)
```javascript
import mongoose from "mongoose";

const commentSchema = new mongoose.Schema({
   contentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "contentType",
      index: true
   },
   contentType: {
      type: String,
      enum: ["Video", "Short", "Post"],
      required: true,
      index: true
   },
   author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
   },
   message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
   },
   parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true // Key for threaded replies query
   },
   likesCount: {
      type: Number,
      default: 0,
      min: 0
   }
}, { timestamps: true });

// Compound Index: Optimizes comment thread listings (Top level & Newest first)
commentSchema.index({ contentId: 1, parentComment: 1, createdAt: -1 });

const Comment = mongoose.model("Comment", commentSchema);
export default Comment;
```

---

### 7. Playlist Schema (`playlists`)
```javascript
import mongoose from "mongoose";

const playlistSchema = new mongoose.Schema({
   channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true
   },
   title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
   },
   description: {
      type: String,
      default: "",
      maxlength: 1000
   },
   thumbnail: {
      type: String,
      default: ""
   },
   visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
      index: true
   }
}, { timestamps: true });

playlistSchema.index({ channel: 1, visibility: 1 });

const Playlist = mongoose.model("Playlist", playlistSchema);
export default Playlist;
```

---

### 8. Playlist Video Schema (`playlistvideos`)
```javascript
import mongoose from "mongoose";

const playlistVideoSchema = new mongoose.Schema({
   playlist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Playlist",
      required: true,
      index: true
   },
   video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      required: true,
      index: true
   },
   order: {
      type: Number,
      default: 0,
      min: 0
   }
}, { timestamps: true });

// Avoid duplicate video entries in the same playlist, and optimize ordering reads
playlistVideoSchema.index({ playlist: 1, video: 1 }, { unique: true });
playlistVideoSchema.index({ playlist: 1, order: 1 });

const PlaylistVideo = mongoose.model("PlaylistVideo", playlistVideoSchema);
export default PlaylistVideo;
```

---

### 9. Subscription Schema (`subscriptions`)
```javascript
import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema({
   subscriber: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
   },
   channel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true
   }
}, { timestamps: true });

// Prevent duplicate subscriptions
subscriptionSchema.index({ subscriber: 1, channel: 1 }, { unique: true });

const Subscription = mongoose.model("Subscription", subscriptionSchema);
export default Subscription;
```

---

### 10. Like Schema (`likes`)
```javascript
import mongoose from "mongoose";

const likeSchema = new mongoose.Schema({
   user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
   },
   contentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "contentType",
      index: true
   },
   contentType: {
      type: String,
      enum: ["Video", "Short", "Post", "Comment"],
      required: true,
      index: true
   },
   type: {
      type: String,
      enum: ["like", "dislike"],
      default: "like"
   }
}, { timestamps: true });

// Ensure a user can only perform one unique reaction per content
likeSchema.index({ user: 1, contentId: 1, contentType: 1 }, { unique: true });
likeSchema.index({ contentId: 1, contentType: 1, type: 1 });

const Like = mongoose.model("Like", likeSchema);
export default Like;
```

---

### 11. History Schema (`histories`)
```javascript
import mongoose from "mongoose";

const historySchema = new mongoose.Schema({
   user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
   },
   contentId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "contentType",
      required: true
   },
   contentType: {
      type: String,
      enum: ["Video", "Short"],
      required: true
   }
}, { timestamps: true });

// Compound Index: Fetch user history in reverse chronological order
historySchema.index({ user: 1, updatedAt: -1 });

// Production TTL strategy: Automatically expire user history logs older than 90 days to control data size
historySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

const History = mongoose.model("History", historySchema);
export default History;
```

---

### 12. Notification Schema (`notifications`)
```javascript
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
   receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
   },
   sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
   },
   type: {
      type: String,
      enum: ["LIKE", "COMMENT", "REPLY", "SUBSCRIBE", "VIDEO_UPLOAD"],
      required: true,
      index: true
   },
   contentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null // Target video/short/post context
   },
   isRead: {
      type: Boolean,
      default: false,
      index: true
   }
}, { timestamps: true });

notificationSchema.index({ receiver: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
```

---

## ⚡ High-Speed Caching Strategy (Redis)

Redis is deployed as an in-memory database to intercept high-frequency read requests and rate limit inbound operations.

```
                  ┌───────────────────────────────┐
                  │    Inbound Client Request     │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                     [ Redis Rate Limiter check ]
                                  │
                                  ├─► [BLOCKED] ──► HTTP 429 Rate Limit Exceeded
                                  │
                                  ▼ [PASSED]
                     [ Check Redis Caching Layer ]
                                  │
                     ┌────────────┴────────────┐
                     ▼ [CACHE HIT]             ▼ [CACHE MISS]
             Return Cached Payload     Query MongoDB Database
             Execution Time: <1ms      Execution Time: 30-200ms
                                               │
                                               ▼
                                      Save to Redis (TTL)
                                               │
                                               ▼
                                     Return Fresh Payload
```

### Strategic Caching Policies
* **Feed & Video Caching**: Home feeds (`feed:all_videos`), trending lists, and video pages are cached. The single video document cache utilizes a 1-hour TTL (`video:id`), invalidated immediately when the video owner makes updates (`PUT /video/:id`).
* **Rate Limiting**: Custom Express keys use Redis backends via `rate-limit-redis`. Rate limit counters automatically reset when the window expires.
* **Tokens & Session Invalidation**: Blacklisted tokens (upon explicit user logout) are cached in Redis under a TTL matching the exact remaining time of the access token.

### What to Never Cache
* **Financial data, session keys, and absolute read-write transactional fields (like OTP states or user credentials).**
* *Caching active OTPs inside Redis is acceptable only if the TTL matches the code expiry time (e.g. 5 minutes) and there is no database record fallback.*

---

## 🚀 Native Pagination Strategies

### Offset Pagination (Skip / Limit)
Perfect for fixed layouts like Creator Studio pages where explicit page jumping is required.
```javascript
// Simple helper utilizing MongoDB skip-limit offset queries
const getPaginatedList = async (Model, filter, { page = 1, limit = 10 }) => {
   const skip = (page - 1) * limit;
   const [data, total] = await Promise.all([
      Model.find(filter).skip(skip).limit(limit).lean(),
      Model.countDocuments(filter)
   ]);
   return {
      data,
      meta: {
         total,
         page,
         limit,
         totalPages: Math.ceil(total / limit),
         hasMore: page * limit < total
      }
   };
};
```
* **Performance warning**: In MongoDB, `{ $skip: 10000 }` requires the engine to scan the first 10,000 index objects before selecting the next 10. Avoid large offsets on primary client feeds!

### Cursor-Based Pagination
Mandatory for infinitely-scrolling home pages and feed listings. It uses the last fetched object's ID (`_id` / `cursor`) to locate page bounds.
```javascript
const getCursorFeed = async (Model, filter, { cursor, limit = 20 }) => {
   const query = cursor ? { ...filter, _id: { $lt: cursor } } : filter;
   const items = await Model.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1) // Fetch 1 extra to check if more items exist
      .lean();

   const hasMore = items.length > limit;
   if (hasMore) items.pop();

   return {
      items,
      meta: {
         nextCursor: hasMore ? items[items.length - 1]._id : null,
         hasMore
      }
   };
};
```

---

## 🐳 Container Architecture & Docker Compose

Deploy with container network isolation, keeping database systems shielded from direct public interface exposure:

```
                  ┌──────────────────────────────────────────────┐
                  │            Public Host Network               │
                  └──────────────────────┬───────────────────────┘
                                         │  Port 80 / 443
                                         ▼
                                  [ Nginx Container ]
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │          Private Internal Docker Network      │
                 └───────────────────────┬───────────────────────┘
                                         │ Proxy to port 8000
                                         ▼
                             [ Backend App Containers ]
                                         │
                            ┌────────────┴────────────┐
                            ▼                         ▼
                   [ Redis Container ]      [ MongoDB Container ]
```

### Complete Multi-Stage `Dockerfile`
```dockerfile
# --- Stage 1: Build dependencies ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# --- Stage 2: Production Execution ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/
COPY ecosystem.config.cjs ./

# Security: Never run containers as root in production!
RUN addgroup -g 1001 -S nodejs && adduser -S nextuser -u 1001
USER nextuser

EXPOSE 8000
CMD ["npx", "pm2-runtime", "start", "ecosystem.config.cjs", "--env", "production"]
```

### Complete `docker-compose.yml`
```yaml
version: '3.8'

networks:
  yt_network:
    driver: bridge

services:
  backend:
    build:
      context: .
      dockerfile: docker/Dockerfile
    restart: always
    environment:
      - NODE_ENV=production
      - MONGO_URI=mongodb://mongodb:27017/ytclone
      - REDIS_URL=redis://redis:6379
    networks:
      - yt_network
    depends_on:
      - mongodb
      - redis

  mongodb:
    image: mongo:6.0
    restart: always
    volumes:
      - mongo_data:/data/db
    networks:
      - yt_network

  redis:
    image: redis:7.0-alpine
    restart: always
    command: redis-server --requirepass securepass123
    volumes:
      - redis_data:/data
    networks:
      - yt_network

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    networks:
      - yt_network
    depends_on:
      - backend

volumes:
  mongo_data:
  redis_data:
```

---

## 🛠️ Zero-Downtime Clustering (PM2 Cluster Mode)

Node.js runs single-threaded. Running standard servers on multi-core systems results in wasted performance. PM2 cluster mode spawns multiple instances of your Node.js application, distributing load across all CPU cores with zero-downtime reloads.

### Spawning PM2 Clustering with Docker
While Docker manages horizontal container scaling, combining **Docker + PM2 Runtime Clustering** scales your application inside each container.
1. **Container Internal Scaling**: spaws workers to utilize CPU bounds allocated to the container.
2. **Zero-downtime code updates**: PM2 executes reloads instance-by-instance (`pm2 reload`).

### PM2 Clustering vs Nginx Load Balancing
* **PM2 Clustering**: Runs on a single machine, sharing port listeners across workers at the OS TCP layer.
* **Nginx Load Balancing**: Distributes HTTP requests across multiple separate servers (IP nodes) or container instances.

---

## 📈 Learning and Implementation Roadmap

```
  Phase 1: Foundation ──► Phase 2: Decoupled Schema ──► Phase 3: High-speed Cache
  (Express, Zod, CSR)     (Decouple Comments/Likes)    (Redis feeds, buffer views)
                                                                   │
  Phase 6: Production ◄──  Phase 5: Docker & PM2 ◄─── Phase 4: Job Queues
  (Nginx, GCP, Prom)      (Containers, Clustering)     (BullMQ, HLS Worker)
```

1. **Phase 1: Foundation**: Set up modular project structure, Express configurations, Pino log integrations, and Zod validator middle layers.
2. **Phase 2: Decoupled Schema & CSR Pattern**: Rebuild schemas using the 12 decoupled models. Implement the Controller-Service-Repository pattern.
3. **Phase 3: High-speed Caching Layers**: Integrate IORedis. Build Feed caches, video document caching hooks, and implement Redis-backed view-count buffer flushes.
4. **Phase 4: Async Job Queues (BullMQ)**: Incorporate BullMQ queues. Move video uploads to worker threads, transcode to adaptive bitrate streams (HLS via FFmpeg), and send notifications in the background.
5. **Phase 5: Dockerization & PM2 Clustering**: Containerize using multi-stage Dockerfiles. Spin up multi-service stacks using Docker Compose. Configure PM2 cluster setups.
6. **Phase 6: Production Hardening & Observability**: Configure Nginx proxies, Prometheus metrics scraping, and build Grafana dashboards. Apply security practices (Helmet, rate limits, HttpOnly cookies).
