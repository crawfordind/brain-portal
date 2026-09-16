import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db/client';
import { getCurrentUser } from '@/lib/auth';

export interface GraphNode {
  id: string;
  title: string;
  slug: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string;
  connectionCount: number;
  isPinned: boolean;
  wordCount: number;
  updatedAt: string;
}

export interface GraphLink {
  source: string;
  target: string;
  type: 'related' | 'references' | 'extends' | 'contradicts' | 'supports';
  strength: number;
  isManual: boolean;
  reason: string | null;
}

export interface GraphCluster {
  id: string;
  label: string;
  nodeIds: string[];
  color: string;
  connectionDensity: number;
}

export interface GraphInsight {
  type: 'hub' | 'orphan' | 'bridge' | 'recent_connection' | 'strong_pair';
  title: string;
  description: string;
  nodeIds: string[];
  priority: number;
}

export interface GraphStats {
  totalNotes: number;
  connectedNotes: number;
  orphanNotes: number;
  totalConnections: number;
  avgConnectionsPerNote: number;
  connectionsByType: Record<string, number>;
  topProjects: { name: string; color: string; noteCount: number }[];
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  clusters: GraphCluster[];
  insights: GraphInsight[];
  stats: GraphStats;
}

// Simple connected-component clustering via BFS
function detectClusters(nodes: GraphNode[], links: GraphLink[], nodeMap: Map<string, GraphNode>): GraphCluster[] {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }
  for (const link of links) {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  const visited = new Set<string>();
  const clusters: GraphCluster[] = [];
  const clusterColors = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#22c55e',
    '#06b6d4', '#eab308', '#ef4444', '#14b8a6', '#0d9488',
  ];

  for (const node of nodes) {
    if (visited.has(node.id) || (adjacency.get(node.id)?.size ?? 0) === 0) continue;

    // BFS
    const queue = [node.id];
    const component: string[] = [];
    visited.add(node.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (component.length >= 2) {
      // Find the most common project name for label
      const projectCounts = new Map<string, number>();
      for (const nid of component) {
        const n = nodeMap.get(nid);
        const key = n?.projectName || 'General';
        projectCounts.set(key, (projectCounts.get(key) || 0) + 1);
      }
      const topProject = [...projectCounts.entries()].sort((a, b) => b[1] - a[1])[0];

      // Count internal edges
      let internalEdges = 0;
      const componentSet = new Set(component);
      for (const link of links) {
        if (componentSet.has(link.source) && componentSet.has(link.target)) {
          internalEdges++;
        }
      }
      const maxEdges = (component.length * (component.length - 1)) / 2;
      const density = maxEdges > 0 ? internalEdges / maxEdges : 0;

      clusters.push({
        id: `cluster-${clusters.length}`,
        label: topProject[0],
        nodeIds: component,
        color: clusterColors[clusters.length % clusterColors.length],
        connectionDensity: Math.round(density * 100) / 100,
      });
    }
  }

  // Sort by size descending
  clusters.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
  return clusters;
}

function generateInsights(nodes: GraphNode[], links: GraphLink[], nodeMap: Map<string, GraphNode>): GraphInsight[] {
  const insights: GraphInsight[] = [];

  // Find hub notes (top connected)
  const hubs = nodes.filter(n => n.connectionCount >= 5).sort((a, b) => b.connectionCount - a.connectionCount).slice(0, 3);
  for (const hub of hubs) {
    insights.push({
      type: 'hub',
      title: `Knowledge Hub: ${hub.title}`,
      description: `Connected to ${hub.connectionCount} other notes. This is a central piece of your knowledge base.`,
      nodeIds: [hub.id],
      priority: 1,
    });
  }

  // Find orphan notes (no connections)
  const orphans = nodes.filter(n => n.connectionCount === 0);
  if (orphans.length > 0) {
    const topOrphans = orphans.sort((a, b) => b.wordCount - a.wordCount).slice(0, 5);
    insights.push({
      type: 'orphan',
      title: `${orphans.length} Unconnected Note${orphans.length !== 1 ? 's' : ''}`,
      description: `These notes have no connections yet. Consider linking them to related topics to strengthen your knowledge network.`,
      nodeIds: topOrphans.map(n => n.id),
      priority: 2,
    });
  }

  // Find bridge notes (connected to multiple clusters)
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const link of links) {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  // Find nodes connected to diverse projects (bridges between domains)
  for (const node of nodes) {
    const neighbors = adjacency.get(node.id);
    if (!neighbors || neighbors.size < 3) continue;
    const neighborProjects = new Set<string>();
    for (const nid of neighbors) {
      const n = nodeMap.get(nid);
      if (n?.projectName) neighborProjects.add(n.projectName);
    }
    if (neighborProjects.size >= 2) {
      insights.push({
        type: 'bridge',
        title: `Bridge Note: ${node.title}`,
        description: `Connects ideas across ${[...neighborProjects].join(', ')}. Bridge notes create valuable cross-domain insights.`,
        nodeIds: [node.id],
        priority: 3,
      });
    }
  }

  // Find strongest pairs
  const strongPairs = links
    .filter(l => l.strength >= 0.8)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);
  for (const pair of strongPairs) {
    const sourceNode = nodeMap.get(pair.source);
    const targetNode = nodeMap.get(pair.target);
    if (sourceNode && targetNode) {
      insights.push({
        type: 'strong_pair',
        title: `Strong Connection`,
        description: `"${sourceNode.title}" and "${targetNode.title}" are highly related (${Math.round(pair.strength * 100)}% similarity).`,
        nodeIds: [pair.source, pair.target],
        priority: 4,
      });
    }
  }

  // Sort by priority
  insights.sort((a, b) => a.priority - b.priority);
  return insights.slice(0, 8);
}

function computeStats(nodes: GraphNode[], links: GraphLink[]): GraphStats {
  const connectedNotes = nodes.filter(n => n.connectionCount > 0).length;
  const orphanNotes = nodes.filter(n => n.connectionCount === 0).length;
  const totalConnections = links.length;
  const avgConnections = nodes.length > 0
    ? Math.round((connectedNotes > 0 ? totalConnections * 2 / connectedNotes : 0) * 10) / 10
    : 0;

  const connectionsByType: Record<string, number> = {};
  for (const link of links) {
    connectionsByType[link.type] = (connectionsByType[link.type] || 0) + 1;
  }

  // Project breakdown
  const projectMap = new Map<string, { color: string; count: number }>();
  for (const node of nodes) {
    if (node.projectName) {
      const existing = projectMap.get(node.projectName);
      if (existing) {
        existing.count++;
      } else {
        projectMap.set(node.projectName, { color: node.projectColor, count: 1 });
      }
    }
  }
  const topProjects = [...projectMap.entries()]
    .map(([name, data]) => ({ name, color: data.color, noteCount: data.count }))
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, 5);

  return {
    totalNotes: nodes.length,
    connectedNotes,
    orphanNotes,
    totalConnections,
    avgConnectionsPerNote: avgConnections,
    connectionsByType,
    topProjects,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '200', 10);

    // Fetch notes with connection counts via pre-aggregated JOIN
    const nodesQuery = `
      SELECT
        n.id,
        n.title,
        n.slug,
        n.is_pinned as isPinned,
        n.word_count as wordCount,
        n.project_id as projectId,
        n.updated_at as updatedAt,
        p.name as projectName,
        COALESCE(p.color, '#6b7280') as projectColor,
        COALESCE(cc.cnt, 0) as connectionCount
      FROM notes n
      LEFT JOIN projects p ON n.project_id = p.id
      LEFT JOIN (
        SELECT note_id, SUM(c) as cnt FROM (
          SELECT source_note_id as note_id, COUNT(*) as c FROM note_connections WHERE user_id = ? GROUP BY source_note_id
          UNION ALL
          SELECT target_note_id as note_id, COUNT(*) as c FROM note_connections WHERE user_id = ? GROUP BY target_note_id
        ) GROUP BY note_id
      ) cc ON cc.note_id = n.id
      WHERE n.user_id = ?
        AND n.is_archived = 0
      ORDER BY connectionCount DESC, n.updated_at DESC
      LIMIT ?
    `;

    const nodes = await queryAll<GraphNode>(nodesQuery, [user.id, user.id, user.id, limit]);

    // If no notes, return empty graph
    if (nodes.length === 0) {
      return NextResponse.json({
        nodes: [],
        links: [],
        clusters: [],
        insights: [],
        stats: {
          totalNotes: 0,
          connectedNotes: 0,
          orphanNotes: 0,
          totalConnections: 0,
          avgConnectionsPerNote: 0,
          connectionsByType: {},
          topProjects: [],
        },
      } satisfies GraphData);
    }

    // Get note IDs for connection query
    const noteIds = nodes.map(n => n.id);
    const placeholders = noteIds.map(() => '?').join(',');

    // Fetch connections between these notes
    const linksQuery = `
      SELECT
        nc.source_note_id as source,
        nc.target_note_id as target,
        nc.connection_type as type,
        nc.strength,
        nc.is_manual as isManual,
        nc.reason
      FROM note_connections nc
      WHERE nc.user_id = ?
        AND nc.source_note_id IN (${placeholders})
        AND nc.target_note_id IN (${placeholders})
    `;

    const links = await queryAll<GraphLink>(linksQuery, [user.id, ...noteIds, ...noteIds]);

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const clusters = detectClusters(nodes, links, nodeMap);
    const insights = generateInsights(nodes, links, nodeMap);
    const stats = computeStats(nodes, links);

    const graphData: GraphData = {
      nodes,
      links,
      clusters,
      insights,
      stats,
    };

    return NextResponse.json(graphData, {
      headers: {
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('Error fetching graph data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch graph data' },
      { status: 500 }
    );
  }
}
