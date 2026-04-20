// 3D Octree with Broccoli-style multi-body leaves and skip-pointers
// Adapted from DeadlockCode/barnes-hut (parallel branch) for GPU traversal

const MAX_DEPTH = 20;

export class OctreeBuilder {
    constructor(theta = 0.7, leafCapacity = 16) {
        this.thetaSq = theta * theta;
        this.leafCapacity = leafCapacity;
        // Reusable buffers (grown as needed, never shrunk)
        this._nodes = [];
        this._leafBodies = [];
    }

    /**
     * Build an octree from GPU position data.
     * @param {Float32Array} positions - RGBA per particle (x, y, z, galaxyIndex)
     * @param {number} numParticles
     * @returns {{ treeA: Float32Array, treeB: Float32Array, leafData: Float32Array, treeTexSize: number, leafTexSize: number, nodeCount: number, leafBodyCount: number, thetaSq: number }}
     */
    build(positions, numParticles) {
        const nodes = this._nodes;
        nodes.length = 0;
        const leafBodies = this._leafBodies;
        leafBodies.length = 0;

        // Find bounding box
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < numParticles; i++) {
            const b = i * 4;
            const px = positions[b], py = positions[b + 1], pz = positions[b + 2];
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (pz < minZ) minZ = pz;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
            if (pz > maxZ) maxZ = pz;
        }

        const cx = (minX + maxX) * 0.5;
        const cy = (minY + maxY) * 0.5;
        const cz = (minZ + maxZ) * 0.5;
        const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) + 1e-6;

        // Allocate root
        nodes.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
        // Node layout: [comX, comY, comZ, mass, children, next, size, leafBodyStart, leafBodyCount]
        //               0     1     2     3     4         5     6     7              8

        // All particle indices
        const allIndices = new Int32Array(numParticles);
        for (let i = 0; i < numParticles; i++) allIndices[i] = i;

        // Work stack (avoid object allocations — use flat array)
        // Entry: [nodeIndex, indicesStart, indicesEnd, cx, cy, cz, size, next, depth]
        // We store indices in a separate buffer and use start/end ranges
        let indicesPool = new Int32Array(numParticles * 2);
        indicesPool.set(allIndices);
        let indicesPoolLen = numParticles;

        const stack = [];
        stack.push(0, 0, numParticles, cx, cy, cz, size, 0, 0);
        // stack stride = 9

        while (stack.length > 0) {
            const depth = stack.pop();
            const next = stack.pop();
            const wSize = stack.pop();
            const wCz = stack.pop();
            const wCy = stack.pop();
            const wCx = stack.pop();
            const indEnd = stack.pop();
            const indStart = stack.pop();
            const nodeIndex = stack.pop();

            const nodeBase = nodeIndex * 9;
            const count = indEnd - indStart;

            // Compute center of mass
            let comX = 0, comY = 0, comZ = 0, totalMass = 0;
            for (let i = indStart; i < indEnd; i++) {
                const idx = indicesPool[i];
                const b = idx * 4;
                const m = 1.0; // uniform mass
                comX += positions[b] * m;
                comY += positions[b + 1] * m;
                comZ += positions[b + 2] * m;
                totalMass += m;
            }
            if (totalMass > 0) {
                const invM = 1.0 / totalMass;
                comX *= invM;
                comY *= invM;
                comZ *= invM;
            }

            nodes[nodeBase + 0] = comX;
            nodes[nodeBase + 1] = comY;
            nodes[nodeBase + 2] = comZ;
            nodes[nodeBase + 3] = totalMass;
            nodes[nodeBase + 5] = next;
            nodes[nodeBase + 6] = wSize;

            // Leaf?
            if (count <= this.leafCapacity || depth >= MAX_DEPTH) {
                nodes[nodeBase + 4] = 0; // children = 0 → leaf
                nodes[nodeBase + 7] = leafBodies.length / 4; // leafBodyStart
                nodes[nodeBase + 8] = count; // leafBodyCount

                for (let i = indStart; i < indEnd; i++) {
                    const idx = indicesPool[i];
                    const b = idx * 4;
                    leafBodies.push(positions[b], positions[b + 1], positions[b + 2], 1.0);
                }
                continue;
            }

            // Branch: partition into 8 octants
            // Use temporary counts to avoid allocating sub-arrays
            const octantCounts = [0, 0, 0, 0, 0, 0, 0, 0];
            for (let i = indStart; i < indEnd; i++) {
                const idx = indicesPool[i];
                const b = idx * 4;
                let octant = 0;
                if (positions[b] >= wCx) octant |= 1;
                if (positions[b + 1] >= wCy) octant |= 2;
                if (positions[b + 2] >= wCz) octant |= 4;
                octantCounts[octant]++;
            }

            // Compute octant start offsets in a new region of indicesPool
            const octantStarts = [0, 0, 0, 0, 0, 0, 0, 0];
            let offset = indicesPoolLen;
            for (let o = 0; o < 8; o++) {
                octantStarts[o] = offset;
                offset += octantCounts[o];
            }

            // Grow indicesPool if needed
            if (offset > indicesPool.length) {
                const newPool = new Int32Array(offset * 2);
                newPool.set(indicesPool);
                indicesPool = newPool;
            }
            indicesPoolLen = offset;

            // Scatter indices into octant regions
            const octantFill = [0, 0, 0, 0, 0, 0, 0, 0];
            for (let i = indStart; i < indEnd; i++) {
                const idx = indicesPool[i];
                const b = idx * 4;
                let octant = 0;
                if (positions[b] >= wCx) octant |= 1;
                if (positions[b + 1] >= wCy) octant |= 2;
                if (positions[b + 2] >= wCz) octant |= 4;
                indicesPool[octantStarts[octant] + octantFill[octant]] = idx;
                octantFill[octant]++;
            }

            // Allocate 8 children consecutively
            const childBase = nodes.length / 9;
            nodes[nodeBase + 4] = childBase; // children index
            for (let i = 0; i < 8; i++) {
                nodes.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
            }

            // Child bounds
            const halfSize = wSize * 0.5;

            // Skip-pointers + push children in reverse order
            for (let i = 7; i >= 0; i--) {
                const childNext = (i < 7) ? childBase + i + 1 : next;
                const childCx = wCx + ((i & 1) ? halfSize * 0.5 : -halfSize * 0.5);
                const childCy = wCy + ((i & 2) ? halfSize * 0.5 : -halfSize * 0.5);
                const childCz = wCz + ((i & 4) ? halfSize * 0.5 : -halfSize * 0.5);

                if (octantCounts[i] === 0) {
                    // Empty child — set as empty leaf, the shader skips mass==0 nodes
                    const cb = (childBase + i) * 9;
                    nodes[cb + 3] = 0;     // mass = 0
                    nodes[cb + 4] = 0;     // children = 0 (leaf)
                    nodes[cb + 5] = childNext;
                    nodes[cb + 6] = halfSize;
                    nodes[cb + 7] = 0;
                    nodes[cb + 8] = 0;
                } else {
                    stack.push(
                        childBase + i,
                        octantStarts[i],
                        octantStarts[i] + octantCounts[i],
                        childCx, childCy, childCz,
                        halfSize,
                        childNext,
                        depth + 1
                    );
                }
            }
        }

        return this._linearize(nodes, leafBodies);
    }

    _linearize(nodes, leafBodies) {
        const nodeCount = nodes.length / 9;
        const treeTexSize = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));
        const treePixels = treeTexSize * treeTexSize;

        // treeTexA: com.x, com.y, com.z, mass
        const treeA = new Float32Array(treePixels * 4);
        // treeTexB: children, next, size, leafBodyStart | (leafBodyCount << 0)
        // Encoding: for leaves (children==0), .w = leafBodyStart, and we pack leafBodyCount in treeA... no
        // Let's use: treeB = vec4(children, next, size, leafBodyStartAndCount)
        // Pack: leafBodyStart in .w, leafBodyCount as separate encoding
        // Cleanest: use treeB.w = leafBodyStart, add leafBodyCount to treeA... no, treeA.w is mass
        // Solution: pack start and count into one float using integer encoding
        // leafBodyStart * 32 + leafBodyCount (count is ≤ 16, so this is safe up to start ~134M)
        const treeB = new Float32Array(treePixels * 4);

        for (let i = 0; i < nodeCount; i++) {
            const nb = i * 9;
            const tb = i * 4;

            treeA[tb + 0] = nodes[nb + 0]; // com.x
            treeA[tb + 1] = nodes[nb + 1]; // com.y
            treeA[tb + 2] = nodes[nb + 2]; // com.z
            treeA[tb + 3] = nodes[nb + 3]; // mass

            treeB[tb + 0] = nodes[nb + 4]; // children (0 = leaf)
            treeB[tb + 1] = nodes[nb + 5]; // next (0 = end)
            treeB[tb + 2] = nodes[nb + 6]; // size
            // Pack leafBodyStart and leafBodyCount:
            // For leaves: encode as start * 32 + count (count ≤ 16)
            // For branches: 0
            if (nodes[nb + 4] === 0) {
                treeB[tb + 3] = nodes[nb + 7] * 32.0 + nodes[nb + 8];
            } else {
                treeB[tb + 3] = 0;
            }
        }

        // Leaf bodies texture
        const leafBodyCount = leafBodies.length / 4;
        const leafTexSize = Math.max(1, Math.ceil(Math.sqrt(leafBodyCount)));
        const leafPixels = leafTexSize * leafTexSize;
        const leafData = new Float32Array(leafPixels * 4);
        for (let i = 0; i < leafBodies.length; i++) {
            leafData[i] = leafBodies[i];
        }

        return {
            treeA,
            treeB,
            leafData,
            treeTexSize,
            leafTexSize,
            nodeCount,
            leafBodyCount,
            thetaSq: this.thetaSq
        };
    }
}
