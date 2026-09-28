import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x081523);
scene.fog = new THREE.Fog(0x081523, 58, 138);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
camera.position.set(0, 42, 50);
camera.lookAt(0, 0, 0);

const ambient = new THREE.HemisphereLight(0xb9ddff, 0x24300d, 2.2);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff0c4, 5);
sun.position.set(-24, 44, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

const worldSize = 82;
const halfWorld = worldSize / 2;
const terrainPatches = [];
const emitters = [];
const props = [];
const keys = new Set();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const pointerTarget = new THREE.Vector3();
const healthyColor = new THREE.Color(0x4e904a);
const dryColor = new THREE.Color(0xc7954e);
const burnedColor = new THREE.Color(0x6f3c2b);

let pointerActive = false;

const state = {
  holeRadius: 4.4,
  uvRadius: 6.8,
  uvIntensity: 0.18,
  score: 0,
  totalDamage: 0,
  emittersDestroyed: 0,
  gameTime: 0
};

const groundGeometry = new THREE.PlaneGeometry(worldSize, worldSize, 34, 34);
groundGeometry.rotateX(-Math.PI / 2);

const groundPosition = groundGeometry.attributes.position;

for (let i = 0; i < groundPosition.count; i += 1) {
  const x = groundPosition.getX(i);
  const z = groundPosition.getZ(i);
  const distance = Math.hypot(x, z);
  const height =
    Math.sin(x * 0.22) * 0.35 +
    Math.cos(z * 0.18) * 0.3 +
    Math.sin((x + z) * 0.11) * 0.28;

  groundPosition.setY(i, height * Math.max(0.15, 1 - distance / 80));
}

groundPosition.needsUpdate = true;
groundGeometry.computeVertexNormals();

const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x3f7f44,
  roughness: 0.94,
  metalness: 0.02
});

const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.receiveShadow = true;
world.add(ground);

const grid = new THREE.GridHelper(worldSize, 41, 0x335166, 0x183043);
grid.position.y = 0.03;
grid.material.opacity = 0.16;
grid.material.transparent = true;
world.add(grid);

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function createPatch(x, z, size) {
  const geometry = new THREE.CircleGeometry(size, 24);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: healthyColor.clone(),
    roughness: 1,
    transparent: true,
    opacity: 0.96
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, 0.06, z);
  mesh.rotation.y = Math.random() * Math.PI;
  mesh.receiveShadow = true;
  mesh.userData.damage = 0;
  mesh.userData.maxDamage = randomRange(0.7, 1.3);

  terrainPatches.push(mesh);
  world.add(mesh);
}

for (let i = 0; i < 150; i += 1) {
  createPatch(
    randomRange(-halfWorld + 3, halfWorld - 3),
    randomRange(-halfWorld + 3, halfWorld - 3),
    randomRange(1.2, 3.4)
  );
}

function createTree(x, z, scale = 1) {
  const tree = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18 * scale, 0.26 * scale, 1.5 * scale, 7),
    new THREE.MeshStandardMaterial({ color: 0x5f4427, roughness: 1 })
  );

  trunk.position.y = 0.75 * scale;
  trunk.castShadow = true;

  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.95 * scale, 2.6 * scale, 7),
    new THREE.MeshStandardMaterial({ color: 0x2f6f39, roughness: 0.9 })
  );

  crown.position.y = 2.5 * scale;
  crown.castShadow = true;

  tree.add(trunk, crown);
  tree.position.set(x, 0, z);
  tree.userData.kind = 'tree';
  tree.userData.health = 1;
  tree.userData.crown = crown;

  props.push(tree);
  world.add(tree);
}

for (let i = 0; i < 54; i += 1) {
  createTree(
    randomRange(-halfWorld + 4, halfWorld - 4),
    randomRange(-halfWorld + 4, halfWorld - 4),
    randomRange(0.72, 1.32)
  );
}

function createBuilding(x, z, width, depth, height, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0.06
    })
  );

  mesh.position.set(x, height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kind = 'building';
  mesh.userData.health = 1;

  props.push(mesh);
  world.add(mesh);
}

for (let i = 0; i < 28; i += 1) {
  createBuilding(
    randomRange(-halfWorld + 5, halfWorld - 5),
    randomRange(-halfWorld + 5, halfWorld - 5),
    randomRange(1.6, 4),
    randomRange(1.6, 4),
    randomRange(2.5, 8),
    new THREE.Color().setHSL(
      randomRange(0.05, 0.12),
      randomRange(0.12, 0.24),
      randomRange(0.42, 0.63)
    )
  );
}

function createEmitter(x, z, strength, size) {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.8, size, size * 0.75, 12),
    new THREE.MeshStandardMaterial({
      color: 0x363a42,
      roughness: 0.64,
      metalness: 0.56
    })
  );

  base.position.y = size * 0.38;
  base.castShadow = true;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.4, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xff684f,
      emissive: 0xff2d1d,
      emissiveIntensity: 4.6,
      roughness: 0.25
    })
  );

  core.position.y = size * 1.08;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(size * 1.1, size * 1.65, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff8d69,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );

  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;

  group.add(base, core, ring);
  group.position.set(x, 0, z);
  group.userData.strength = strength;
  group.userData.size = size;
  group.userData.core = core;
  group.userData.ring = ring;
  group.userData.alive = true;

  emitters.push(group);
  world.add(group);
}

[
  [-28, -25, 0.8, 0.9],
  [-16, -18, 0.7, 0.8],
  [4, -28, 0.95, 1],
  [24, -21, 1.15, 1.1],
  [31, -4, 1.3, 1.2],
  [19, 16, 1.05, 1.05],
  [31, 28, 1.5, 1.3],
  [4, 28, 0.9, 0.95],
  [-17, 26, 1.2, 1.1],
  [-31, 13, 1.4, 1.2],
  [-26, -3, 0.85, 0.9],
  [-4, 5, 0.7, 0.8],
  [11, 7, 0.8, 0.9],
  [0, 17, 1.15, 1.08]
].forEach((data) => createEmitter(...data));

const hole = new THREE.Group();
scene.add(hole);

const shadowDisc = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    color: 0x121829,
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  })
);

shadowDisc.rotation.x = -Math.PI / 2;
shadowDisc.position.y = 8.6;
hole.add(shadowDisc);

const holeRing = new THREE.Mesh(
  new THREE.RingGeometry(0.74, 1, 64),
  new THREE.MeshBasicMaterial({
    color: 0x6db9ff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);

holeRing.rotation.x = -Math.PI / 2;
holeRing.position.y = 8.55;
hole.add(holeRing);

const uvDisc = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    color: 0xffdd68,
    transparent: true,
    opacity: 0.13,
    depthWrite: false
  })
);

uvDisc.rotation.x = -Math.PI / 2;
uvDisc.position.y = 0.16;
hole.add(uvDisc);

const uvEdge = new THREE.Mesh(
  new THREE.RingGeometry(0.94, 1, 64),
  new THREE.MeshBasicMaterial({
    color: 0xfff49a,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);

uvEdge.rotation.x = -Math.PI / 2;
uvEdge.position.y = 0.18;
hole.add(uvEdge);

const beamMaterial = new THREE.MeshBasicMaterial({
  color: 0xffef9e,
  transparent: true,
  opacity: 0.035,
  side: THREE.DoubleSide,
  depthWrite: false
});

const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1.12, 8.4, 48, 1, true),
  beamMaterial
);

beam.position.y = 4.4;
hole.add(beam);

const sunOrb = new THREE.Mesh(
  new THREE.SphereGeometry(2.1, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff6bd })
);

sunOrb.position.set(-26, 28, -16);
scene.add(sunOrb);

const holePosition = new THREE.Vector3(0, 0, 0);
hole.position.copy(holePosition);

function updateHoleVisuals() {
  shadowDisc.scale.setScalar(state.holeRadius);
  holeRing.scale.setScalar(state.holeRadius);
  uvDisc.scale.setScalar(state.uvRadius);
  uvEdge.scale.setScalar(state.uvRadius);
  beam.scale.set(state.holeRadius * 0.9, 1, state.holeRadius * 0.9);

  uvDisc.material.opacity = 0.08 + state.uvIntensity * 0.16;
  beamMaterial.opacity = 0.018 + state.uvIntensity * 0.05;
}

function clampHole() {
  holePosition.x = THREE.MathUtils.clamp(
    holePosition.x,
    -halfWorld + 2,
    halfWorld - 2
  );

  holePosition.z = THREE.MathUtils.clamp(
    holePosition.z,
    -halfWorld + 2,
    halfWorld - 2
  );
}

function destroyEmitter(emitter) {
  if (!emitter.userData.alive) return;

  const strength = emitter.userData.strength;

  emitter.userData.alive = false;
  state.holeRadius += 0.34 + strength * 0.24;
  state.uvRadius += 0.48 + strength * 0.34;
  state.uvIntensity = Math.min(
    1,
    state.uvIntensity + 0.035 + strength * 0.018
  );
  state.score += Math.round(120 * strength);
  state.emittersDestroyed += 1;

  emitter.userData.core.material.emissiveIntensity = 0;
  emitter.userData.core.material.color.set(0x4a4c50);
  emitter.userData.ring.visible = false;
  emitter.scale.setScalar(0.72);

  updateHoleVisuals();
}

function damageTerrain(delta) {
  let damaged = 0;

  for (const patch of terrainPatches) {
    const dx = patch.position.x - holePosition.x;
    const dz = patch.position.z - holePosition.z;
    const distance = Math.hypot(dx, dz);

    if (distance < state.uvRadius + 1.2) {
      const factor =
        1 - Math.min(1, distance / (state.uvRadius + 1.2));

      patch.userData.damage = Math.min(
        patch.userData.maxDamage,
        patch.userData.damage +
          delta *
            state.uvIntensity *
            (0.15 + factor * 0.95)
      );

      const progress = Math.min(
        1,
        patch.userData.damage / patch.userData.maxDamage
      );

      const color = healthyColor.clone();

      if (progress < 0.58) {
        color.lerp(dryColor, progress / 0.58);
      } else {
        color
          .copy(dryColor)
          .lerp(
            burnedColor,
            (progress - 0.58) / 0.42
          );
      }

      patch.material.color.copy(color);
      damaged += progress;
    } else {
      damaged += Math.min(
        1,
        patch.userData.damage / patch.userData.maxDamage
      );
    }
  }

  for (const prop of props) {
    const dx = prop.position.x - holePosition.x;
    const dz = prop.position.z - holePosition.z;
    const distance = Math.hypot(dx, dz);

    if (distance >= state.uvRadius) continue;

    prop.userData.health = Math.max(
      0,
      prop.userData.health -
        delta * state.uvIntensity * 0.04
    );

    if (prop.userData.kind === 'tree') {
      const progress = 1 - prop.userData.health;
      const treeHealthy = new THREE.Color(0x2f6f39);
      const treeDry = new THREE.Color(0x8b6737);

      prop.userData.crown.material.color.copy(
        treeHealthy.lerp(treeDry, progress)
      );

      prop.scale.y =
        0.78 + prop.userData.health * 0.22;
    }

    if (prop.userData.kind === 'building') {
      const progress = 1 - prop.userData.health;

      prop.material.emissive.setRGB(
        progress * 0.08,
        progress * 0.035,
        0
      );
    }
  }

  state.totalDamage =
    damaged / terrainPatches.length;
}

function checkEmitters() {
  for (const emitter of emitters) {
    if (!emitter.userData.alive) continue;

    emitter.rotation.y += 0.012;
    emitter.userData.core.position.y =
      emitter.userData.size *
      (
        1.08 +
        Math.sin(
          state.gameTime * 4 +
          emitter.position.x
        ) *
          0.08
      );

    const dx =
      emitter.position.x - holePosition.x;
    const dz =
      emitter.position.z - holePosition.z;
    const distance = Math.hypot(dx, dz);

    if (
      distance <
      state.holeRadius * 0.88 +
        emitter.userData.size
    ) {
      destroyEmitter(emitter);
    }
  }
}

function updateHud() {
  document.querySelector('#holeValue').textContent =
    `${Math.round(state.holeRadius * 2)} m`;

  document.querySelector('#uvValue').textContent =
    `${Math.round(state.uvIntensity * 100)}%`;

  document.querySelector('#damageValue').textContent =
    `${Math.round(state.totalDamage * 100)}%`;

  document.querySelector('#scoreValue').textContent =
    state.score.toLocaleString('en-US');

  document.querySelector('#holeBar').style.width =
    `${Math.min(100, (state.holeRadius / 16) * 100)}%`;

  document.querySelector('#uvBar').style.width =
    `${state.uvIntensity * 100}%`;

  document.querySelector('#damageBar').style.width =
    `${state.totalDamage * 100}%`;
}

function updatePointerTarget(event) {
  const rect = canvas.getBoundingClientRect();

  pointer.x =
    ((event.clientX - rect.left) /
      rect.width) *
      2 -
    1;

  pointer.y =
    -(
      (event.clientY - rect.top) /
      rect.height
    ) *
      2 +
    1;

  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObject(
    ground,
    false
  )[0];

  if (!hit) return;

  pointerTarget.copy(hit.point);
  pointerTarget.y = 0;
  pointerActive = true;
}

function moveHole(delta) {
  const move = new THREE.Vector3();

  if (
    keys.has('KeyW') ||
    keys.has('ArrowUp')
  ) {
    move.z -= 1;
  }

  if (
    keys.has('KeyS') ||
    keys.has('ArrowDown')
  ) {
    move.z += 1;
  }

  if (
    keys.has('KeyA') ||
    keys.has('ArrowLeft')
  ) {
    move.x -= 1;
  }

  if (
    keys.has('KeyD') ||
    keys.has('ArrowRight')
  ) {
    move.x += 1;
  }

  if (move.lengthSq() > 0) {
    pointerActive = false;

    move
      .normalize()
      .multiplyScalar(
        delta *
          (10 +
            state.holeRadius * 0.18)
      );

    holePosition.add(move);
  } else if (pointerActive) {
    const toTarget = pointerTarget
      .clone()
      .sub(holePosition);

    toTarget.y = 0;

    if (toTarget.length() > 0.35) {
      const speed =
        delta *
        (9 +
          state.holeRadius * 0.16);

      holePosition.add(
        toTarget
          .normalize()
          .multiplyScalar(
            Math.min(
              speed,
              toTarget.length()
            )
          )
      );
    }
  }

  clampHole();

  hole.position.x = THREE.MathUtils.lerp(
    hole.position.x,
    holePosition.x,
    0.22
  );

  hole.position.z = THREE.MathUtils.lerp(
    hole.position.z,
    holePosition.z,
    0.22
  );
}

function updateCamera() {
  const target = new THREE.Vector3(
    hole.position.x * 0.26,
    0,
    hole.position.z * 0.26
  );

  const zoomOut = Math.min(
    18,
    Math.max(
      0,
      state.holeRadius - 4.4
    ) * 0.78
  );

  const desired = new THREE.Vector3(
    hole.position.x * 0.16,
    42 + zoomOut,
    50 +
      zoomOut * 0.78 +
      hole.position.z * 0.1
  );

  camera.position.lerp(
    desired,
    0.025
  );

  camera.lookAt(target);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  renderer.setSize(
    width,
    height,
    false
  );

  camera.aspect =
    width / height;

  camera.updateProjectionMatrix();
}

canvas.addEventListener(
  'pointermove',
  updatePointerTarget
);

canvas.addEventListener(
  'pointerdown',
  updatePointerTarget
);

window.addEventListener(
  'keydown',
  (event) => {
    keys.add(event.code);
  }
);

window.addEventListener(
  'keyup',
  (event) => {
    keys.delete(event.code);
  }
);

window.addEventListener(
  'resize',
  resize
);

document
  .querySelector('#restartBtn')
  .addEventListener(
    'click',
    () => {
      window.location.reload();
    }
  );

updateHoleVisuals();
resize();

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(
    clock.getDelta(),
    0.05
  );

  state.gameTime += delta;

  moveHole(delta);
  checkEmitters();
  damageTerrain(delta);
  updateCamera();
  updateHud();

  holeRing.rotation.z +=
    delta * 0.2;

  uvEdge.rotation.z -=
    delta * 0.12;

  renderer.render(
    scene,
    camera
  );
}

animate();
