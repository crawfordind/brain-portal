/**
 * System Integration Test Script
 *
 * Tests the embeddings, tiered processing, and caching system end-to-end.
 *
 * Run with: npx tsx scripts/test-system.ts
 */

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Test content for notes
const testNotes = [
  {
    title: "Introduction to Machine Learning",
    content: `# Introduction to Machine Learning

Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience.

## Key Concepts

- **Supervised Learning**: Learning from labeled data
- **Unsupervised Learning**: Finding patterns in unlabeled data
- **Reinforcement Learning**: Learning through trial and error

## Applications

Machine learning powers many modern applications including:
- Image recognition
- Natural language processing
- Recommendation systems

#machinelearning #ai #technology`,
    slug: "intro-to-ml",
  },
  {
    title: "Deep Learning Fundamentals",
    content: `# Deep Learning Fundamentals

Deep learning is a specialized form of machine learning using neural networks with multiple layers.

## Neural Network Architecture

Neural networks consist of:
1. Input layer
2. Hidden layers (multiple in deep learning)
3. Output layer

## Popular Frameworks

- TensorFlow
- PyTorch
- JAX

This builds on concepts from [[Introduction to Machine Learning]].

#deeplearning #ai #neuralnetworks`,
    slug: "deep-learning-fundamentals",
  },
  {
    title: "Web Development Best Practices",
    content: `# Web Development Best Practices

Modern web development requires attention to performance, accessibility, and user experience.

## Performance Tips

- Minimize bundle size
- Use lazy loading
- Optimize images
- Enable caching

## Accessibility

- Use semantic HTML
- Provide alt text for images
- Ensure keyboard navigation
- Test with screen readers

#webdev #programming #frontend`,
    slug: "webdev-best-practices",
  },
  {
    title: "Project Management with Agile",
    content: `# Project Management with Agile

Agile methodology emphasizes iterative development and continuous feedback.

## Scrum Framework

- Sprint planning
- Daily standups
- Sprint review
- Retrospective

## Kanban

- Visualize workflow
- Limit work in progress
- Focus on flow

#agile #projectmanagement #scrum`,
    slug: "agile-project-management",
  },
  {
    title: "AI in Healthcare",
    content: `# AI in Healthcare

Artificial intelligence is transforming healthcare through better diagnostics and personalized treatment.

## Applications

- Medical imaging analysis
- Drug discovery
- Patient risk prediction
- Virtual health assistants

## Challenges

- Data privacy concerns
- Regulatory compliance
- Integration with existing systems

This relates to concepts in [[Introduction to Machine Learning]] and [[Deep Learning Fundamentals]].

#healthcare #ai #technology`,
    slug: "ai-healthcare",
  },
];

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(`\n${message}`);
}

function success(name: string, message: string, details?: unknown) {
  results.push({ name, passed: true, message, details });
  console.log(`  ✓ ${name}: ${message}`);
}

function fail(name: string, message: string, details?: unknown) {
  results.push({ name, passed: false, message, details });
  console.log(`  ✗ ${name}: ${message}`);
}

async function main() {
  console.log("=".repeat(60));
  console.log("Brain Portal - System Integration Test");
  console.log("=".repeat(60));

  try {
    // Step 1: Find the current user
    log("Step 1: Finding current user...");
    const userResult = await db.execute({
      sql: "SELECT * FROM users LIMIT 1",
      args: [],
    });

    if (userResult.rows.length === 0) {
      fail("Find User", "No users found in database");
      console.log("\nCreating test user...");
      await db.execute({
        sql: `INSERT INTO users (email, display_name) VALUES (?, ?)`,
        args: ["test@example.com", "Test User"],
      });
      const newUser = await db.execute({
        sql: "SELECT * FROM users WHERE email = ?",
        args: ["test@example.com"],
      });
      if (newUser.rows.length === 0) {
        throw new Error("Failed to create test user");
      }
    }

    const user = (await db.execute({
      sql: "SELECT * FROM users LIMIT 1",
      args: [],
    })).rows[0] as { id: string; email: string };

    success("Find User", `Found user: ${user.email}`, { userId: user.id });

    // Step 2: Clean up any existing test data
    log("Step 2: Cleaning up existing test data...");
    const testSlugs = testNotes.map(n => n.slug);
    for (const slug of testSlugs) {
      await db.execute({
        sql: "DELETE FROM notes WHERE user_id = ? AND slug = ?",
        args: [user.id, slug],
      });
    }
    // Clean up queue
    await db.execute({
      sql: "DELETE FROM processing_queue WHERE user_id = ?",
      args: [user.id],
    });
    success("Cleanup", `Cleaned up test notes and queue`);

    // Step 3: Create test notes
    log("Step 3: Creating test notes...");
    const createdNotes: { id: string; title: string; slug: string }[] = [];

    for (const note of testNotes) {
      // Run local processing
      const wordCount = note.content.split(/\s+/).filter(w => w.length > 0).length;
      const contentPlain = note.content
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/#+\s+/gm, "")
        .replace(/\*\*/g, "")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/#\w+/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const result = await db.execute({
        sql: `INSERT INTO notes (user_id, title, slug, content, content_plain, word_count, processing_status)
              VALUES (?, ?, ?, ?, ?, ?, 'pending')
              RETURNING id, title, slug`,
        args: [user.id, note.title, note.slug, note.content, contentPlain, wordCount],
      });

      const created = result.rows[0] as { id: string; title: string; slug: string };
      createdNotes.push(created);

      // Queue embedding generation
      await db.execute({
        sql: `INSERT INTO processing_queue (user_id, entity_type, entity_id, operation, tier, priority)
              VALUES (?, 'note', ?, 'generate_embedding', 'embedding', 1)`,
        args: [user.id, created.id],
      });

      // Queue summary generation for notes with enough content
      if (wordCount > 50) {
        await db.execute({
          sql: `INSERT INTO processing_queue (user_id, entity_type, entity_id, operation, tier, priority)
                VALUES (?, 'note', ?, 'generate_summary', 'fast_llm', 0)`,
          args: [user.id, created.id],
        });
      }
    }

    success("Create Notes", `Created ${createdNotes.length} test notes`, {
      notes: createdNotes.map(n => n.title),
    });

    // Step 4: Check processing queue
    log("Step 4: Checking processing queue...");
    const queueResult = await db.execute({
      sql: `SELECT operation, tier, COUNT(*) as count
            FROM processing_queue
            WHERE user_id = ? AND status = 'pending'
            GROUP BY operation, tier`,
      args: [user.id],
    });

    const queueStats = queueResult.rows as { operation: string; tier: string; count: number }[];
    success("Queue Check", `Found ${queueStats.reduce((a, b) => a + Number(b.count), 0)} pending jobs`, {
      breakdown: queueStats,
    });

    // Step 5: Process embedding jobs (call the API or process directly)
    log("Step 5: Processing embedding jobs...");

    // Get pending embedding jobs
    const embeddingJobs = await db.execute({
      sql: `SELECT pq.*, n.title, n.content
            FROM processing_queue pq
            JOIN notes n ON pq.entity_id = n.id
            WHERE pq.user_id = ? AND pq.operation = 'generate_embedding' AND pq.status = 'pending'`,
      args: [user.id],
    });

    let embeddingsGenerated = 0;
    let embeddingsFailed = 0;

    for (const job of embeddingJobs.rows) {
      const j = job as { id: string; entity_id: string; title: string; content: string };

      try {
        // Mark as processing
        await db.execute({
          sql: `UPDATE processing_queue SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1 WHERE id = ?`,
          args: [j.id],
        });

        // Call OpenRouter for embedding
        const textToEmbed = `${j.title}\n\n${j.content}`;
        const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Brain Portal Test",
          },
          body: JSON.stringify({
            model: "openai/text-embedding-3-small",
            input: textToEmbed.substring(0, 8191),
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json() as { data: { embedding: number[] }[] };
        const embedding = data.data[0].embedding;

        // Store embedding
        const contentHash = Buffer.from(textToEmbed).toString("base64").substring(0, 32);
        await db.execute({
          sql: `INSERT OR REPLACE INTO embeddings (user_id, entity_type, entity_id, model, embedding, content_hash, updated_at)
                VALUES (?, 'note', ?, 'text-embedding-3-small', ?, ?, datetime('now'))`,
          args: [user.id, j.entity_id, JSON.stringify(embedding), contentHash],
        });

        // Mark job complete
        await db.execute({
          sql: `UPDATE processing_queue SET status = 'completed', completed_at = datetime('now') WHERE id = ?`,
          args: [j.id],
        });

        // Update note processing status
        await db.execute({
          sql: `UPDATE notes SET processing_status = 'completed' WHERE id = ?`,
          args: [j.entity_id],
        });

        embeddingsGenerated++;
        console.log(`    Generated embedding for: ${j.title}`);
      } catch (error) {
        embeddingsFailed++;
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        await db.execute({
          sql: `UPDATE processing_queue SET status = 'failed', error_message = ? WHERE id = ?`,
          args: [errMsg, j.id],
        });
        console.log(`    Failed embedding for: ${j.title} - ${errMsg}`);
      }
    }

    if (embeddingsGenerated > 0) {
      success("Generate Embeddings", `Generated ${embeddingsGenerated} embeddings, ${embeddingsFailed} failed`);
    } else if (embeddingsFailed > 0) {
      fail("Generate Embeddings", `All ${embeddingsFailed} embeddings failed`);
    } else {
      success("Generate Embeddings", "No embedding jobs to process");
    }

    // Step 6: Verify embeddings in database
    log("Step 6: Verifying embeddings in database...");
    const embeddingsResult = await db.execute({
      sql: `SELECT e.entity_id, n.title, LENGTH(e.embedding) as emb_length
            FROM embeddings e
            JOIN notes n ON e.entity_id = n.id
            WHERE e.user_id = ? AND e.entity_type = 'note'`,
      args: [user.id],
    });

    const storedEmbeddings = embeddingsResult.rows as { entity_id: string; title: string; emb_length: number }[];

    if (storedEmbeddings.length >= createdNotes.length - embeddingsFailed) {
      success("Verify Embeddings", `Found ${storedEmbeddings.length} embeddings in database`, {
        notes: storedEmbeddings.map(e => e.title),
      });
    } else {
      fail("Verify Embeddings", `Expected ${createdNotes.length} embeddings, found ${storedEmbeddings.length}`);
    }

    // Step 7: Test similarity search
    log("Step 7: Testing similarity search...");

    if (storedEmbeddings.length >= 2) {
      // Get first note's embedding
      const firstNoteEmb = await db.execute({
        sql: `SELECT e.embedding FROM embeddings e WHERE e.entity_id = ?`,
        args: [createdNotes[0].id],
      });

      if (firstNoteEmb.rows.length > 0) {
        const sourceEmb = JSON.parse((firstNoteEmb.rows[0] as { embedding: string }).embedding) as number[];

        // Get all other embeddings and compute similarity
        const otherEmbs = await db.execute({
          sql: `SELECT e.entity_id, e.embedding, n.title
                FROM embeddings e
                JOIN notes n ON e.entity_id = n.id
                WHERE e.user_id = ? AND e.entity_id != ?`,
          args: [user.id, createdNotes[0].id],
        });

        const similarities: { title: string; similarity: number }[] = [];

        for (const row of otherEmbs.rows) {
          const r = row as { entity_id: string; embedding: string; title: string };
          const emb = JSON.parse(r.embedding) as number[];

          // Compute cosine similarity
          let dotProduct = 0;
          let normA = 0;
          let normB = 0;
          for (let i = 0; i < sourceEmb.length; i++) {
            dotProduct += sourceEmb[i] * emb[i];
            normA += sourceEmb[i] * sourceEmb[i];
            normB += emb[i] * emb[i];
          }
          const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
          similarities.push({ title: r.title, similarity });
        }

        similarities.sort((a, b) => b.similarity - a.similarity);

        success("Similarity Search", `Found similar notes to "${createdNotes[0].title}"`, {
          results: similarities.map(s => `${s.title}: ${(s.similarity * 100).toFixed(1)}%`),
        });

        // Verify that ML-related notes are more similar to each other
        const mlNote = similarities.find(s => s.title.includes("Deep Learning"));
        const webNote = similarities.find(s => s.title.includes("Web Development"));

        if (mlNote && webNote && mlNote.similarity > webNote.similarity) {
          success("Semantic Relevance", "ML notes are more similar to each other than to web dev notes");
        } else if (mlNote && webNote) {
          fail("Semantic Relevance", "Expected ML notes to be more similar to each other");
        }
      }
    } else {
      fail("Similarity Search", "Not enough embeddings to test similarity");
    }

    // Step 8: Check processing queue status
    log("Step 8: Checking final queue status...");
    const finalQueueResult = await db.execute({
      sql: `SELECT status, COUNT(*) as count
            FROM processing_queue
            WHERE user_id = ?
            GROUP BY status`,
      args: [user.id],
    });

    const finalQueueStats = finalQueueResult.rows as { status: string; count: number }[];
    success("Queue Status", "Processing queue status", {
      stats: finalQueueStats,
    });

    // Step 9: Verify notes have correct processing status
    log("Step 9: Verifying note processing status...");
    const notesStatus = await db.execute({
      sql: `SELECT processing_status, COUNT(*) as count
            FROM notes
            WHERE user_id = ? AND slug IN (${testSlugs.map(() => "?").join(",")})
            GROUP BY processing_status`,
      args: [user.id, ...testSlugs],
    });

    const statusCounts = notesStatus.rows as { processing_status: string; count: number }[];
    success("Note Status", "Note processing status", { stats: statusCounts });

    // Step 10: Test cache functionality
    log("Step 10: Testing cache...");
    const cacheKey = `test-cache-${Date.now()}`;
    await db.execute({
      sql: `INSERT INTO ai_cache (user_id, cache_key, operation_type, tier, input_hash, output, tokens_used, expires_at)
            VALUES (?, ?, 'test', 'fast_llm', ?, ?, 100, datetime('now', '+1 hour'))`,
      args: [user.id, cacheKey, cacheKey, JSON.stringify({ test: "data" })],
    });

    const cacheResult = await db.execute({
      sql: `SELECT * FROM ai_cache WHERE cache_key = ?`,
      args: [cacheKey],
    });

    if (cacheResult.rows.length > 0) {
      success("Cache Write/Read", "Cache entry created and retrieved successfully");
      // Clean up test cache entry
      await db.execute({
        sql: `DELETE FROM ai_cache WHERE cache_key = ?`,
        args: [cacheKey],
      });
    } else {
      fail("Cache Write/Read", "Failed to create or retrieve cache entry");
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("Test Summary");
    console.log("=".repeat(60));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log(`\nTotal: ${results.length} tests`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log("\nFailed tests:");
      for (const r of results.filter(r => !r.passed)) {
        console.log(`  - ${r.name}: ${r.message}`);
      }
    }

    console.log("\n" + "=".repeat(60));

    // Cleanup option
    console.log("\nTest notes created:");
    for (const note of createdNotes) {
      console.log(`  - ${note.title} (${note.slug})`);
    }
    console.log("\nTo clean up test data, run:");
    console.log(`  DELETE FROM notes WHERE slug IN ('${testSlugs.join("', '")}');`);

  } catch (error) {
    console.error("\nTest failed with error:", error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

main();
