// Lifelike skin for the massage simulator, made in the page (no image files): a tileable detail colour map (mottling,
// capillary blush, pores), a normal map (pores and the fine criss-cross lines of real skin) and a roughness map, on a
// physical material with a soft sheen. skinMaterial({ oil: true }) also reads a per-vertex `oil` attribute (0..1) that
// makes worked skin glisten.
import * as THREE from 'three';

// Tileable value noise: a period x period lattice, smooth-interpolated.
function lattice(period, seed) {
  let s = seed * 9973 + 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const v = new Float32Array(period * period); for (let i = 0; i < v.length; i++) v[i] = rnd();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => v[((j % period + period) % period) * period + ((i % period + period) % period)];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// Height, colour and roughness fields for one tile, size x size pixels.
function fields(size, seed) {
  const height = new Float32Array(size * size), tone = new Float32Array(size * size), blush = new Float32Array(size * size), rough = new Float32Array(size * size);
  const low = lattice(6, seed), mid = lattice(24, seed + 1), fine = lattice(96, seed + 2), lineA = lattice(48, seed + 3), lineB = lattice(48, seed + 4), cap = lattice(12, seed + 5);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, k = y * size + x;
    // the skin's fine relief: lines running two ways (stretched noise along two diagonals), a little general bumpiness
    const la = lineA((u + v) * 48 * .5, (u - v) * 48 * 3), lb = lineB((u - v) * 48 * .5, (u + v) * 48 * 3);
    height[k] = .35 * mid(u * 24, v * 24) + .25 * fine(u * 96, v * 96) - .45 * Math.max(0, .5 - la) - .45 * Math.max(0, .5 - lb);
    tone[k] = .6 * low(u * 6, v * 6) + .4 * mid(u * 24, v * 24);
    blush[k] = Math.max(0, cap(u * 12, v * 12) - .55) * 2.2;          // patches of capillary colour
    rough[k] = .5 + .3 * fine(u * 96, v * 96);
  }
  // pores: small pits, a little darker and rougher
  let s = seed * 31 + 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pores = Math.round(size * size / 90);
  for (let p = 0; p < pores; p++) {
    const cx = rnd() * size, cy = rnd() * size, r = .8 + rnd() * 1.1, depth = .5 + rnd() * .6;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const d2 = (dx + (cx % 1)) ** 2 + (dy + (cy % 1)) ** 2; if (d2 > r * r * 2.2) continue;
      const k = ((Math.floor(cy) + dy + size) % size) * size + (Math.floor(cx) + dx + size) % size, f = Math.exp(-d2 / (r * r));
      height[k] -= depth * f; tone[k] -= .25 * f; rough[k] += .25 * f;
    }
  }
  return { height, tone, blush, rough };
}

function canvasTexture(size, paint, color = false) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), image = g.createImageData(size, size); paint(image.data);
  g.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// { map, normalMap, roughnessMap }: map is near-white detail meant to be multiplied by the skin colour.
export function skinMaps(size = 512, seed = 1) {
  const { height, tone, blush, rough } = fields(size, seed);
  const map = canvasTexture(size, d => {
    for (let k = 0; k < size * size; k++) {
      const t = .93 + .07 * tone[k], b = Math.min(1, blush[k]);
      d[k * 4] = 255 * Math.min(1, t * (1 + .02 * b)); d[k * 4 + 1] = 255 * t * (1 - .07 * b); d[k * 4 + 2] = 255 * t * (1 - .06 * b); d[k * 4 + 3] = 255;
    }
  }, true);
  const normalMap = canvasTexture(size, d => {
    const H = (x, y) => height[((y + size) % size) * size + (x + size) % size], strength = 2.2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const k = y * size + x, nx = (H(x - 1, y) - H(x + 1, y)) * strength, ny = (H(x, y - 1) - H(x, y + 1)) * strength, l = Math.hypot(nx, ny, 1);
      d[k * 4] = 127.5 + 127.5 * nx / l; d[k * 4 + 1] = 127.5 - 127.5 * ny / l; d[k * 4 + 2] = 127.5 + 127.5 / l; d[k * 4 + 3] = 255;
    }
  });
  const roughnessMap = canvasTexture(size, d => {
    for (let k = 0; k < size * size; k++) { const r = 255 * Math.min(1, rough[k]); d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = r; d[k * 4 + 3] = 255; }
  });
  return { map, normalMap, roughnessMap, dispose() { map.dispose(); normalMap.dispose(); roughnessMap.dispose(); } };
}

// Physical skin: sheen for the soft velvet look at grazing angles, a warm tint; oil: per-vertex shine.
export function skinMaterial(maps, { color = '#d9a07e', vertexColors = false, oil = false, roughness = .62, normalScale = .45 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color, vertexColors, map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(normalScale, normalScale), roughnessMap: maps.roughnessMap,
    roughness, metalness: 0, sheen: .45, sheenRoughness: .55, sheenColor: new THREE.Color('#ff9a7a'), specularIntensity: .45, specularColor: new THREE.Color('#ffe7dc'),
  });
  if (oil) {
    m.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float oil;\nvarying float vOil;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOil = oil;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vOil;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .2, clamp(vOil, 0., 1.));');
    };
    m.customProgramCacheKey = () => 'massage-skin-oil';
  }
  return m;
}
