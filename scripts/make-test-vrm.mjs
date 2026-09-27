/**
 * Writes a tiny, self-authored VRM 1.0 model for testing VN mode's 3D path without any third-party
 * asset: a blocky figure with every required humanoid bone and a face mesh whose morph targets
 * drive the standard VRM expressions (happy, angry, sad, relaxed, surprised, aa, blink).
 *
 *   node scripts/make-test-vrm.mjs [out.vrm] [--color r,g,b]
 */
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const colorIndex = argv.indexOf('--color')
const colorArg = colorIndex === -1 ? '0.25,0.55,0.45' : argv[colorIndex + 1]
const out = argv.find((a, i) => !a.startsWith('--') && (colorIndex === -1 || i !== colorIndex + 1)) ?? 'test-avatar.vrm'
const clothes = [...colorArg.split(',').map(Number), 1]

const nodes = []
const meshes = []
const accessors = []
const bufferViews = []
const chunks = []
let byteLength = 0

function pushData(typed, target) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
  const pad = (4 - (bytes.length % 4)) % 4
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) })
  chunks.push(bytes, Buffer.alloc(pad))
  byteLength += bytes.length + pad
  return bufferViews.length - 1
}

function vec3Accessor(values) {
  const arr = new Float32Array(values)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], arr[i + k]); max[k] = Math.max(max[k], arr[i + k]) }
  accessors.push({ bufferView: pushData(arr, 34962), componentType: 5126, count: arr.length / 3, type: 'VEC3', min, max })
  return accessors.length - 1
}

function indexAccessor(values) {
  accessors.push({ bufferView: pushData(new Uint16Array(values), 34963), componentType: 5123, count: values.length, type: 'SCALAR' })
  return accessors.length - 1
}

const materials = [
  { name: 'skin', pbrMetallicRoughness: { baseColorFactor: [0.96, 0.82, 0.72, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
  { name: 'clothes', pbrMetallicRoughness: { baseColorFactor: clothes, metallicFactor: 0, roughnessFactor: 0.8 } },
  { name: 'face', pbrMetallicRoughness: { baseColorFactor: [0.12, 0.1, 0.12, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true },
  { name: 'hair', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.14, 0.1, 1], metallicFactor: 0, roughnessFactor: 0.7 } },
]

/** An axis-aligned box as one indexed primitive with flat normals. */
function box([sx, sy, sz], [ox, oy, oz] = [0, 0, 0]) {
  const p = []
  const n = []
  const idx = []
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ]
  for (const [normal, u, v] of faces) {
    const base = p.length / 3
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) p.push([ox, oy, oz][k] + (normal[k] + u[k] * a + v[k] * b) * [sx, sy, sz][k] / 2)
      n.push(...normal)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { p, n, idx }
}

function meshNode(name, parts, parent) {
  const primitives = parts.map(({ geo, material }) => ({
    attributes: { POSITION: vec3Accessor(geo.p), NORMAL: vec3Accessor(geo.n) },
    indices: indexAccessor(geo.idx),
    material,
  }))
  meshes.push({ name, primitives })
  nodes.push({ name, mesh: meshes.length - 1 })
  nodes[parent].children = [...(nodes[parent].children ?? []), nodes.length - 1]
  return nodes.length - 1
}

// Skeleton (T-pose, facing +Z, character's left = +X). Translations are relative to the parent.
const bones = {}
function bone(name, translation, parent) {
  nodes.push({ name, translation })
  const i = nodes.length - 1
  bones[name] = i
  if (parent !== undefined) nodes[bones[parent]].children = [...(nodes[bones[parent]].children ?? []), i]
  return i
}
bone('hips', [0, 0.95, 0])
bone('spine', [0, 0.12, 0], 'hips')
bone('chest', [0, 0.18, 0], 'spine')
bone('neck', [0, 0.2, 0], 'chest')
bone('head', [0, 0.08, 0], 'neck')
for (const [side, x] of [['left', 1], ['right', -1]]) {
  bone(`${side}Shoulder`, [0.05 * x, 0.16, 0], 'chest')
  bone(`${side}UpperArm`, [0.12 * x, 0, 0], `${side}Shoulder`)
  bone(`${side}LowerArm`, [0.26 * x, 0, 0], `${side}UpperArm`)
  bone(`${side}Hand`, [0.24 * x, 0, 0], `${side}LowerArm`)
  bone(`${side}UpperLeg`, [0.09 * x, -0.05, 0], 'hips')
  bone(`${side}LowerLeg`, [0, -0.42, 0], `${side}UpperLeg`)
  bone(`${side}Foot`, [0, -0.42, 0], `${side}LowerLeg`)
}

const SKIN = 0, CLOTHES = 1, FACE = 2, HAIR = 3
meshNode('Pelvis', [{ geo: box([0.3, 0.16, 0.18]), material: CLOTHES }], bones.hips)
meshNode('Torso', [{ geo: box([0.32, 0.38, 0.18], [0, 0.12, 0]), material: CLOTHES }], bones.spine)
meshNode('NeckMesh', [{ geo: box([0.08, 0.1, 0.08], [0, 0.03, 0]), material: SKIN }], bones.neck)
meshNode('HeadMesh', [
  { geo: box([0.22, 0.26, 0.22], [0, 0.12, 0]), material: SKIN },
  { geo: box([0.24, 0.08, 0.24], [0, 0.26, -0.01]), material: HAIR },
], bones.head)
for (const side of ['left', 'right']) {
  const x = side === 'left' ? 1 : -1
  meshNode(`${side}UpperArmMesh`, [{ geo: box([0.26, 0.08, 0.08], [0.13 * x, 0, 0]), material: CLOTHES }], bones[`${side}UpperArm`])
  meshNode(`${side}LowerArmMesh`, [{ geo: box([0.24, 0.07, 0.07], [0.12 * x, 0, 0]), material: SKIN }], bones[`${side}LowerArm`])
  meshNode(`${side}HandMesh`, [{ geo: box([0.09, 0.06, 0.04], [0.045 * x, 0, 0]), material: SKIN }], bones[`${side}Hand`])
  meshNode(`${side}UpperLegMesh`, [{ geo: box([0.11, 0.42, 0.11], [0, -0.21, 0]), material: CLOTHES }], bones[`${side}UpperLeg`])
  meshNode(`${side}LowerLegMesh`, [{ geo: box([0.09, 0.4, 0.09], [0, -0.2, 0]), material: CLOTHES }], bones[`${side}LowerLeg`])
  meshNode(`${side}FootMesh`, [{ geo: box([0.09, 0.05, 0.16], [0, -0.03, 0.04]), material: HAIR }], bones[`${side}Foot`])
}

// Face: flat quads just in front of the head box, with one morph target per VRM expression.
const zf = 0.111
const quads = {
  eyeL: [0.05, 0.15, 0.03, 0.035], eyeR: [-0.05, 0.15, 0.03, 0.035],
  browL: [0.05, 0.195, 0.045, 0.01], browR: [-0.05, 0.195, 0.045, 0.01],
  mouth: [0, 0.065, 0.07, 0.012],
}
const facePos = []
const faceNormals = []
const faceIdx = []
const quadVerts = {}
for (const [name, [cx, cy, w, h]] of Object.entries(quads)) {
  const base = facePos.length / 3
  quadVerts[name] = base
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { facePos.push(cx + (a * w) / 2, cy + (b * h) / 2, zf); faceNormals.push(0, 0, 1) }
  faceIdx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}
const vcount = facePos.length / 3
/** A morph target: per-quad, per-corner [dx, dy] offsets. Corners: 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left. */
function target(spec) {
  const d = new Array(vcount * 3).fill(0)
  for (const [name, corners] of Object.entries(spec)) {
    corners.forEach(([dx, dy], c) => { const v = quadVerts[name] + c; d[v * 3] = dx; d[v * 3 + 1] = dy })
  }
  return vec3Accessor(d)
}
const eyeClose = [[0, 0.016], [0, 0.016], [0, -0.016], [0, -0.016]]
const squint = [[0, 0.012], [0, 0.012], [0, -0.004], [0, -0.004]]
const lift = [[0, 0.02], [0, 0.02], [0, 0.02], [0, 0.02]]
const widen = [[-0.006, -0.008], [0.006, -0.008], [0.006, 0.008], [-0.006, 0.008]]
const expressions = {
  happy: target({ mouth: [[-0.01, 0.012], [0.01, 0.012], [0.02, 0.02], [-0.02, 0.02]], eyeL: squint, eyeR: squint }),
  angry: target({ browL: [[0, 0], [0, -0.02], [0, -0.02], [0, 0]], browR: [[0, -0.02], [0, 0], [0, 0], [0, -0.02]], mouth: [[0.01, 0], [-0.01, 0], [-0.01, 0], [0.01, 0]] }),
  sad: target({ browL: [[0, -0.012], [0, 0.01], [0, 0.01], [0, -0.012]], browR: [[0, 0.01], [0, -0.012], [0, -0.012], [0, 0.01]], mouth: [[0.01, -0.01], [-0.01, -0.01], [-0.02, -0.006], [0.02, -0.006]] }),
  relaxed: target({ eyeL: [[0, 0.01], [0, 0.01], [0, -0.008], [0, -0.008]], eyeR: [[0, 0.01], [0, 0.01], [0, -0.008], [0, -0.008]], mouth: [[0, 0.004], [0, 0.004], [0, 0.004], [0, 0.004]] }),
  surprised: target({ eyeL: widen, eyeR: widen, browL: lift, browR: lift, mouth: [[0.02, -0.02], [-0.02, -0.02], [-0.02, 0.01], [0.02, 0.01]] }),
  aa: target({ mouth: [[0.01, -0.03], [-0.01, -0.03], [-0.01, 0], [0.01, 0]] }),
  blink: target({ eyeL: eyeClose, eyeR: eyeClose }),
}
const targetNames = Object.keys(expressions)
meshes.push({
  name: 'Face',
  primitives: [{
    attributes: { POSITION: vec3Accessor(facePos), NORMAL: vec3Accessor(faceNormals) },
    indices: indexAccessor(faceIdx),
    material: FACE,
    targets: targetNames.map((name) => ({ POSITION: expressions[name] })),
  }],
  weights: targetNames.map(() => 0),
  extras: { targetNames },
})
nodes.push({ name: 'Face', mesh: meshes.length - 1 })
const faceNode = nodes.length - 1
nodes[bones.head].children = [...(nodes[bones.head].children ?? []), faceNode]

const humanBones = Object.fromEntries(Object.entries(bones).map(([name, node]) => [name, { node }]))
const preset = Object.fromEntries(targetNames.map((name, index) => [name, { morphTargetBinds: [{ node: faceNode, index, weight: 1 }] }]))

const gltf = {
  asset: { version: '2.0', generator: 'rp-engine make-test-vrm' },
  extensionsUsed: ['VRMC_vrm'],
  scene: 0,
  scenes: [{ nodes: [bones.hips] }],
  nodes,
  meshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
  extensions: {
    VRMC_vrm: {
      specVersion: '1.0',
      meta: {
        name: 'RP test figure',
        version: '1',
        authors: ['rp-engine test generator'],
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
        avatarPermission: 'everyone',
        allowExcessivelyViolentUsage: false,
        allowExcessivelySexualUsage: false,
        commercialUsage: 'personalNonProfit',
        allowPoliticalOrReligiousUsage: false,
        allowAntisocialOrHateUsage: false,
        creditNotation: 'unnecessary',
        allowRedistribution: true,
        modification: 'allowModification',
      },
      humanoid: { humanBones },
      expressions: { preset },
    },
  },
}

const json = Buffer.from(JSON.stringify(gltf))
const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)
const bin = Buffer.concat(chunks)
const total = 12 + 8 + json.length + jsonPad.length + 8 + bin.length
const header = Buffer.alloc(12)
header.write('glTF', 0, 'latin1'); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8)
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length + jsonPad.length, 0); jsonHeader.write('JSON', 4, 'latin1')
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.write('BIN\0', 4, 'latin1')
writeFileSync(out, Buffer.concat([header, jsonHeader, json, jsonPad, binHeader, bin]))
console.log(`Wrote ${out} (${total} bytes, ${Object.keys(bones).length} bones, expressions: ${targetNames.join(', ')})`)
