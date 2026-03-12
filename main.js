import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- CONFIGURATION ---
const GRAVITY = 30;
const JUMP_FORCE = 10;
const MOVE_SPEED = 10;
const KNIFE_SPEED_MULT = 1.5;
const PLAYER_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.4;
const ARENA_SIZE = 40;     // half-size
const CEILING_HEIGHT = 12;

// Bots
const BOT_SPEED = 3.5;
const BOT_COUNT = 8;
const BOT_HEALTH = 60;
const BOT_DAMAGE = 8;
const BOT_ATTACK_RANGE = 2.5;
const BOT_ATTACK_COOLDOWN = 1000;
const PLAYER_MAX_HEALTH = 100;

// --- GAME STATE ---
let camera, scene, renderer, controls;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, canJump = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
let playerHealth = PLAYER_MAX_HEALTH;
let kills = 0;

// Collision
const colliders = [];   // array of THREE.Box3
const floorSegments = []; // {box3, topY} for stairs/ramps

// Weapons
const weapons = {
    knife:   { name: 'Faca',              color: 0xffaa00, fireRate: 500,  ammo: Infinity, maxAmmo: Infinity, damage: 50,  range: 3,    isKnife: true,  key: '4' },
    pistol:  { name: 'Pistola',           color: 0x00ff7f, fireRate: 400,  ammo: 12,       maxAmmo: 12,       damage: 25,  range: 1000, isKnife: false, key: '1' },
    smg:     { name: 'Submetralhadora',   color: 0x00d2ff, fireRate: 100,  ammo: 30,       maxAmmo: 30,       damage: 12,  range: 1000, isKnife: false, key: '2' },
    sniper:  { name: 'Rifle de Precisão', color: 0xff007f, fireRate: 1500, ammo: 5,        maxAmmo: 5,        damage: 100, range: 1000, isKnife: false, key: '3' }
};
let currentWeapon = weapons.pistol;
let currentWeaponKey = 'pistol';
let lastFireTime = 0;
let weaponGroup; // visible weapon mesh

// Bots
const bots = [];

init();
animate();

function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080818);
    scene.fog = new THREE.FogExp2(0x080818, 0.015);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, PLAYER_HEIGHT, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    sunLight.position.set(10, CEILING_HEIGHT - 1, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    // Neon Point Lights
    const colors = [0x00ff7f, 0x00d2ff, 0xff007f, 0xffaa00];
    const positions = [
        [-ARENA_SIZE + 5, 6, -ARENA_SIZE + 5],
        [ARENA_SIZE - 5, 6, -ARENA_SIZE + 5],
        [-ARENA_SIZE + 5, 6, ARENA_SIZE - 5],
        [ARENA_SIZE - 5, 6, ARENA_SIZE - 5]
    ];
    for (let i = 0; i < 4; i++) {
        const pl = new THREE.PointLight(colors[i], 3, 50);
        pl.position.set(...positions[i]);
        scene.add(pl);

        // Visible bulb
        const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 8, 8),
            new THREE.MeshBasicMaterial({ color: colors[i] })
        );
        bulb.position.copy(pl.position);
        scene.add(bulb);
    }

    // Controls
    controls = new PointerLockControls(camera, document.body);
    const instructions = document.getElementById('instructions');
    instructions.addEventListener('click', () => controls.lock());
    controls.addEventListener('lock', () => { instructions.style.display = 'none'; });
    controls.addEventListener('unlock', () => { instructions.style.display = 'block'; });
    scene.add(controls.getObject());

    // Input
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', (e) => {
        if (controls.isLocked && e.button === 0) fire();
    });

    // Build World
    createArena();
    createStairs();

    // Weapon Model
    createWeaponModel('pistol');

    // Bots
    spawnBots();

    window.addEventListener('resize', onWindowResize);
}

function onKeyDown(e) {
    switch (e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'Space': if (canJump) { velocity.y = JUMP_FORCE; canJump = false; } break;
        case 'Digit1': switchWeapon('pistol'); break;
        case 'Digit2': switchWeapon('smg'); break;
        case 'Digit3': switchWeapon('sniper'); break;
        case 'Digit4': switchWeapon('knife'); break;
        case 'KeyR': reloadWeapon(); break;
    }
}

function onKeyUp(e) {
    switch (e.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
    }
}

// ========================
// ARENA (Closed Room)
// ========================
function createArena() {
    const S = ARENA_SIZE;
    const H = CEILING_HEIGHT;

    // --- Floor ---
    const floorGeo = new THREE.PlaneGeometry(S * 2, S * 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.7 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Neon Grid on floor
    const grid = new THREE.GridHelper(S * 2, 40, 0x00ff7f, 0x111111);
    grid.position.y = 0.01;
    scene.add(grid);

    // --- Ceiling ---
    const ceilGeo = new THREE.PlaneGeometry(S * 2, S * 2);
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1, side: THREE.DoubleSide });
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    scene.add(ceil);

    // Ceiling lights (strips)
    for (let i = -3; i <= 3; i++) {
        const stripGeo = new THREE.BoxGeometry(S * 1.5, 0.1, 0.3);
        const stripMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(0, H - 0.05, i * 10);
        scene.add(strip);
    }

    // --- Walls ---
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.6 });
    const wallThickness = 1;

    const wallDefs = [
        // {w, h, d, x, y, z}
        { w: S * 2 + wallThickness * 2, h: H, d: wallThickness, x: 0, y: H / 2, z: S + wallThickness / 2 },   // North
        { w: S * 2 + wallThickness * 2, h: H, d: wallThickness, x: 0, y: H / 2, z: -S - wallThickness / 2 },  // South
        { w: wallThickness, h: H, d: S * 2, x: S + wallThickness / 2, y: H / 2, z: 0 },    // East
        { w: wallThickness, h: H, d: S * 2, x: -S - wallThickness / 2, y: H / 2, z: 0 },   // West
    ];

    for (const def of wallDefs) {
        const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set(def.x, def.y, def.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        // Add collider
        const box = new THREE.Box3().setFromObject(mesh);
        colliders.push(box);
    }

    // Add neon stripes on walls
    const neonColors = [0x00ff7f, 0x00d2ff, 0xff007f, 0xffaa00];
    for (let i = 0; i < 4; i++) {
        const def = wallDefs[i];
        for (let j = 1; j <= 2; j++) {
            const stripeH = 0.15;
            const stripeGeo = new THREE.BoxGeometry(
                def.d > 1 ? 0.2 : def.w * 0.9,
                stripeH,
                def.d > 1 ? def.d * 0.9 : 0.2
            );
            const stripeMat = new THREE.MeshBasicMaterial({ color: neonColors[i] });
            const stripe = new THREE.Mesh(stripeGeo, stripeMat);
            stripe.position.set(def.x, j * 3, def.z);
            scene.add(stripe);
        }
    }

    // --- Cover Boxes ---
    const coverMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.5 });
    const coverPositions = [
        { s: [3, 2, 3], p: [15, 1, 15] },
        { s: [3, 2, 3], p: [-15, 1, 15] },
        { s: [3, 2, 3], p: [15, 1, -15] },
        { s: [3, 2, 3], p: [-15, 1, -15] },
        { s: [5, 1.5, 1], p: [0, 0.75, 20] },
        { s: [5, 1.5, 1], p: [0, 0.75, -20] },
        { s: [1, 1.5, 5], p: [20, 0.75, 0] },
        { s: [1, 1.5, 5], p: [-20, 0.75, 0] },
        { s: [2, 3, 2], p: [10, 1.5, 0] },
        { s: [2, 3, 2], p: [-10, 1.5, 0] },
    ];
    for (const c of coverPositions) {
        const geo = new THREE.BoxGeometry(...c.s);
        const mesh = new THREE.Mesh(geo, coverMat);
        mesh.position.set(...c.p);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        colliders.push(new THREE.Box3().setFromObject(mesh));
    }
}

// ========================
// STAIRS
// ========================
function createStairs() {
    const stairCount = 10;
    const stepWidth = 4;
    const stepDepth = 1.2;
    const stepHeight = 0.5;
    const startX = -ARENA_SIZE + 5;
    const startZ = -ARENA_SIZE + 3;

    const stairMat = new THREE.MeshStandardMaterial({ color: 0x444466, roughness: 0.4 });

    for (let i = 0; i < stairCount; i++) {
        const geo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
        const mesh = new THREE.Mesh(geo, stairMat);
        const y = stepHeight / 2 + i * stepHeight;
        const z = startZ + i * stepDepth;
        mesh.position.set(startX, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        const box = new THREE.Box3().setFromObject(mesh);
        colliders.push(box);
        floorSegments.push({ box3: box, topY: y + stepHeight / 2 });
    }

    // Platform at top of stairs
    const platGeo = new THREE.BoxGeometry(8, 0.5, 8);
    const platMesh = new THREE.Mesh(platGeo, new THREE.MeshStandardMaterial({ color: 0x555577 }));
    const platY = stairCount * stepHeight;
    platMesh.position.set(startX, platY + 0.25, startZ + stairCount * stepDepth + 3);
    platMesh.castShadow = true;
    platMesh.receiveShadow = true;
    scene.add(platMesh);

    const platBox = new THREE.Box3().setFromObject(platMesh);
    colliders.push(platBox);
    floorSegments.push({ box3: platBox, topY: platY + 0.5 });

    // Railing (visual)
    const railMat = new THREE.MeshBasicMaterial({ color: 0x00ff7f });
    for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < stairCount; i++) {
            const railGeo = new THREE.BoxGeometry(0.1, 1, 0.1);
            const rail = new THREE.Mesh(railGeo, railMat);
            const y = stepHeight / 2 + i * stepHeight + 0.5;
            const z = startZ + i * stepDepth;
            rail.position.set(startX + side * (stepWidth / 2), y, z);
            scene.add(rail);
        }
    }

    // Label
    const labelGeo = new THREE.BoxGeometry(0.1, 1, 3);
    const labelMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(startX - stepWidth / 2 - 0.5, 1.5, startZ + 1);
    scene.add(label);
}

// ========================
// WEAPON MODELS (First Person)
// ========================
function createWeaponModel(type) {
    // Remove old weapon
    if (weaponGroup) camera.remove(weaponGroup);

    weaponGroup = new THREE.Group();
    const color = weapons[type].color;

    if (type === 'knife') {
        // Blade
        const bladeGeo = new THREE.BoxGeometry(0.03, 0.02, 0.35);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(0, 0, -0.2);
        weaponGroup.add(blade);

        // Blade edge (thin line)
        const edgeGeo = new THREE.BoxGeometry(0.005, 0.025, 0.35);
        const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const edge = new THREE.Mesh(edgeGeo, edgeMat);
        edge.position.set(0.018, 0, -0.2);
        weaponGroup.add(edge);

        // Handle
        const handleGeo = new THREE.BoxGeometry(0.04, 0.12, 0.04);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x553300 });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.set(0, -0.06, -0.01);
        weaponGroup.add(handle);

        // Guard
        const guardGeo = new THREE.BoxGeometry(0.08, 0.02, 0.02);
        const guardMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.8 });
        const guard = new THREE.Mesh(guardGeo, guardMat);
        guard.position.set(0, 0, -0.02);
        weaponGroup.add(guard);

        weaponGroup.position.set(0.35, -0.25, -0.4);
        weaponGroup.rotation.set(0.3, -0.2, -0.4);

    } else if (type === 'pistol') {
        // Slide
        const slideGeo = new THREE.BoxGeometry(0.06, 0.06, 0.3);
        const slideMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.2 });
        const slide = new THREE.Mesh(slideGeo, slideMat);
        slide.position.set(0, 0.03, -0.1);
        weaponGroup.add(slide);

        // Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8);
        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.03, -0.29);
        weaponGroup.add(barrel);

        // Grip
        const gripGeo = new THREE.BoxGeometry(0.05, 0.12, 0.06);
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.set(0, -0.04, 0.02);
        grip.rotation.x = -0.2;
        weaponGroup.add(grip);

        // Trigger
        const trigGeo = new THREE.BoxGeometry(0.01, 0.04, 0.02);
        const trigMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
        const trig = new THREE.Mesh(trigGeo, trigMat);
        trig.position.set(0, -0.01, -0.02);
        weaponGroup.add(trig);

        // Glow accent
        const accentGeo = new THREE.BoxGeometry(0.065, 0.01, 0.3);
        const accentMat = new THREE.MeshBasicMaterial({ color: color });
        const accent = new THREE.Mesh(accentGeo, accentMat);
        accent.position.set(0, 0.065, -0.1);
        weaponGroup.add(accent);

        weaponGroup.position.set(0.32, -0.3, -0.45);
        weaponGroup.rotation.set(0, 0.05, 0);

    } else if (type === 'smg') {
        // Body
        const bodyGeo = new THREE.BoxGeometry(0.07, 0.07, 0.45);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.3 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 0.02, -0.15);
        weaponGroup.add(body);

        // Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.15, 8);
        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.44);
        weaponGroup.add(barrel);

        // Magazine
        const magGeo = new THREE.BoxGeometry(0.04, 0.15, 0.04);
        const magMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
        const mag = new THREE.Mesh(magGeo, magMat);
        mag.position.set(0, -0.06, -0.08);
        mag.rotation.x = -0.15;
        weaponGroup.add(mag);

        // Grip
        const gripGeo = new THREE.BoxGeometry(0.05, 0.1, 0.05);
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.set(0, -0.04, 0.08);
        grip.rotation.x = -0.3;
        weaponGroup.add(grip);

        // Stock
        const stockGeo = new THREE.BoxGeometry(0.05, 0.05, 0.18);
        const stockMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const stock = new THREE.Mesh(stockGeo, stockMat);
        stock.position.set(0, 0.02, 0.16);
        weaponGroup.add(stock);

        // Glow strips
        const stripGeo = new THREE.BoxGeometry(0.075, 0.01, 0.45);
        const stripMat = new THREE.MeshBasicMaterial({ color: color });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(0, 0.06, -0.15);
        weaponGroup.add(strip);

        weaponGroup.position.set(0.3, -0.3, -0.4);

    } else if (type === 'sniper') {
        // Long barrel body
        const bodyGeo = new THREE.BoxGeometry(0.06, 0.06, 0.7);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.1 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 0.02, -0.25);
        weaponGroup.add(body);

        // Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8);
        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 1 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.72);
        weaponGroup.add(barrel);

        // Scope
        const scopeGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8);
        const scopeMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9 });
        const scope = new THREE.Mesh(scopeGeo, scopeMat);
        scope.position.set(0, 0.08, -0.15);
        weaponGroup.add(scope);

        // Scope lens glow
        const lensGeo = new THREE.CircleGeometry(0.025, 8);
        const lensMat = new THREE.MeshBasicMaterial({ color: color });
        const lens1 = new THREE.Mesh(lensGeo, lensMat);
        lens1.position.set(0, 0.08, -0.075);
        lens1.rotation.y = Math.PI;
        weaponGroup.add(lens1);

        // Stock
        const stockGeo = new THREE.BoxGeometry(0.06, 0.08, 0.25);
        const stockMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
        const stock = new THREE.Mesh(stockGeo, stockMat);
        stock.position.set(0, 0, 0.2);
        weaponGroup.add(stock);

        // Grip
        const gripGeo = new THREE.BoxGeometry(0.04, 0.1, 0.04);
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.set(0, -0.04, 0.05);
        grip.rotation.x = -0.3;
        weaponGroup.add(grip);

        // Glow accent
        const accentGeo = new THREE.BoxGeometry(0.065, 0.008, 0.7);
        const accentMat = new THREE.MeshBasicMaterial({ color: color });
        const accent = new THREE.Mesh(accentGeo, accentMat);
        accent.position.set(0, 0.055, -0.25);
        weaponGroup.add(accent);

        weaponGroup.position.set(0.3, -0.32, -0.35);
    }

    camera.add(weaponGroup);
}

// ========================
// WEAPON LOGIC
// ========================
function switchWeapon(type) {
    currentWeapon = weapons[type];
    currentWeaponKey = type;
    createWeaponModel(type);
    document.getElementById('weapon-info').textContent = currentWeapon.name;
    updateUI();
}

function reloadWeapon() {
    if (currentWeapon.isKnife) return;
    currentWeapon.ammo = currentWeapon.maxAmmo;
    updateUI();
}

function fire() {
    const now = performance.now();
    if (now - lastFireTime < currentWeapon.fireRate) return;

    if (currentWeapon.isKnife) {
        lastFireTime = now;
        knifeAttack();
        // Knife swing anim
        if (weaponGroup) {
            weaponGroup.rotation.x -= 0.6;
            setTimeout(() => { if (weaponGroup) weaponGroup.rotation.x += 0.6; }, 150);
        }
        return;
    }

    if (currentWeapon.ammo <= 0) return;

    lastFireTime = now;
    currentWeapon.ammo--;
    updateUI();

    // Recoil animation
    if (weaponGroup) {
        weaponGroup.position.z += 0.08;
        weaponGroup.rotation.x -= 0.05;
        setTimeout(() => {
            if (weaponGroup) {
                weaponGroup.position.z -= 0.08;
                weaponGroup.rotation.x += 0.05;
            }
        }, 60);
    }

    // Visual Flash
    const flash = new THREE.PointLight(currentWeapon.color, 20, 10);
    flash.position.set(0.3, -0.2, -0.8);
    camera.add(flash);
    setTimeout(() => camera.remove(flash), 50);

    // Hitscan
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    // Check bots
    const botMeshParts = [];
    bots.filter(b => b.alive).forEach(b => {
        b.mesh.traverse(child => { if (child.isMesh) botMeshParts.push({ mesh: child, bot: b }); });
    });

    const allMeshes = botMeshParts.map(bp => bp.mesh);
    const intersects = raycaster.intersectObjects(allMeshes, false);
    if (intersects.length > 0) {
        const hitObj = intersects[0].object;
        createImpact(intersects[0].point, currentWeapon.color);

        for (const bp of botMeshParts) {
            if (bp.mesh === hitObj) {
                damageBot(bp.bot, currentWeapon.damage);
                break;
            }
        }
    } else {
        // Hit world
        const worldIntersects = raycaster.intersectObjects(scene.children, false);
        if (worldIntersects.length > 0) {
            createImpact(worldIntersects[0].point, currentWeapon.color);
        }
    }
}

function knifeAttack() {
    const playerPos = controls.getObject().position;
    const cameraDir = new THREE.Vector3();
    camera.getWorldDirection(cameraDir);

    for (const bot of bots) {
        if (!bot.alive) continue;
        const botPos = bot.mesh.position.clone();
        botPos.y = playerPos.y;
        const dist = playerPos.distanceTo(botPos);

        if (dist < currentWeapon.range) {
            const toBot = botPos.clone().sub(playerPos).normalize();
            const dot = cameraDir.dot(toBot);
            if (dot > 0.4) {
                damageBot(bot, currentWeapon.damage);
                createImpact(bot.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xffaa00);
                break;
            }
        }
    }
}

function createImpact(point, color) {
    const geo = new THREE.SphereGeometry(0.15, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const impact = new THREE.Mesh(geo, mat);
    impact.position.copy(point);
    scene.add(impact);
    setTimeout(() => scene.remove(impact), 200);
}

// ========================
// BOTS
// ========================
function createBotMesh() {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.8, 1.2, 0.5);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x330000, emissiveIntensity: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.25, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xff5555, emissive: 0x440000, emissiveIntensity: 0.5 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.75;
    group.add(head);

    const eyeGeo = new THREE.SphereGeometry(0.05, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, 1.8, 0.2);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.1, 1.8, 0.2);
    group.add(eyeR);

    const armGeo = new THREE.BoxGeometry(0.2, 0.8, 0.2);
    const armMat = new THREE.MeshStandardMaterial({ color: 0xcc2222 });
    const armL = new THREE.Mesh(armGeo, armMat);
    armL.position.set(-0.5, 0.9, 0);
    group.add(armL);
    const armR = new THREE.Mesh(armGeo, armMat);
    armR.position.set(0.5, 0.9, 0);
    group.add(armR);

    const legGeo = new THREE.BoxGeometry(0.25, 0.7, 0.25);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x991111 });
    const legL = new THREE.Mesh(legGeo, legMat);
    legL.position.set(-0.2, 0.15, 0);
    group.add(legL);
    const legR = new THREE.Mesh(legGeo, legMat);
    legR.position.set(0.2, 0.15, 0);
    group.add(legR);

    // HP bar background
    const hpBg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide })
    );
    hpBg.position.y = 2.15;
    group.add(hpBg);

    // HP bar fill
    const hpFill = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide })
    );
    hpFill.position.y = 2.16;
    hpFill.name = 'hpBar';
    group.add(hpFill);

    return group;
}

function spawnBots() {
    for (let i = 0; i < BOT_COUNT; i++) {
        const mesh = createBotMesh();
        const angle = (i / BOT_COUNT) * Math.PI * 2;
        const r = 15 + Math.random() * 15;
        mesh.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        scene.add(mesh);

        bots.push({
            mesh, health: BOT_HEALTH, maxHealth: BOT_HEALTH,
            speed: BOT_SPEED * (0.8 + Math.random() * 0.4),
            lastAttackTime: 0, alive: true, respawnTimer: 0
        });
    }
}

function respawnBot(bot) {
    bot.health = BOT_HEALTH;
    bot.alive = true;
    bot.mesh.visible = true;
    const angle = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * 15;
    bot.mesh.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);

    const hpBar = bot.mesh.getObjectByName('hpBar');
    if (hpBar) { hpBar.scale.x = 1; hpBar.material.color.setHex(0x00ff00); }
}

function damageBot(bot, damage) {
    bot.health -= damage;
    const hpBar = bot.mesh.getObjectByName('hpBar');
    if (hpBar) {
        const ratio = Math.max(0, bot.health / bot.maxHealth);
        hpBar.scale.x = ratio;
        if (ratio > 0.5) hpBar.material.color.setHex(0x00ff00);
        else if (ratio > 0.25) hpBar.material.color.setHex(0xffff00);
        else hpBar.material.color.setHex(0xff0000);
    }
    if (bot.health <= 0) killBot(bot);
}

function killBot(bot) {
    bot.alive = false;
    bot.mesh.visible = false;
    bot.respawnTimer = 5;
    kills++;
    updateKillsUI();
}

function updateBots(delta, time) {
    const playerPos = controls.getObject().position;

    for (const bot of bots) {
        if (!bot.alive) {
            bot.respawnTimer -= delta;
            if (bot.respawnTimer <= 0) respawnBot(bot);
            continue;
        }

        const botPos = bot.mesh.position;
        const dx = playerPos.x - botPos.x;
        const dz = playerPos.z - botPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > BOT_ATTACK_RANGE) {
            const moveX = (dx / dist) * bot.speed * delta;
            const moveZ = (dz / dist) * bot.speed * delta;
            // Simple bot collision: stay inside arena
            const nx = botPos.x + moveX;
            const nz = botPos.z + moveZ;
            if (Math.abs(nx) < ARENA_SIZE - 1 && Math.abs(nz) < ARENA_SIZE - 1) {
                botPos.x = nx;
                botPos.z = nz;
            }
        }

        bot.mesh.lookAt(playerPos.x, 0, playerPos.z);

        // Animate legs
        const legSpeed = dist > BOT_ATTACK_RANGE ? 8 : 0;
        const bob = Math.sin(time * 0.001 * legSpeed + bots.indexOf(bot)) * 0.1;
        if (bot.mesh.children[6]) bot.mesh.children[6].position.y = 0.15 + bob;
        if (bot.mesh.children[7]) bot.mesh.children[7].position.y = 0.15 - bob;

        // Attack
        if (dist < BOT_ATTACK_RANGE && controls.isLocked) {
            const now = performance.now();
            if (now - bot.lastAttackTime > BOT_ATTACK_COOLDOWN) {
                bot.lastAttackTime = now;
                playerHealth -= BOT_DAMAGE;
                if (playerHealth < 0) playerHealth = 0;
                updateHealthUI();
                flashDamage();
                if (playerHealth <= 0) handlePlayerDeath();
            }
        }

        // HP bar face camera
        const hpBar = bot.mesh.getObjectByName('hpBar');
        if (hpBar) hpBar.lookAt(camera.position);
        if (bot.mesh.children[8]) bot.mesh.children[8].lookAt(camera.position);
    }
}

function handlePlayerDeath() {
    playerHealth = PLAYER_MAX_HEALTH;
    kills = 0;
    controls.getObject().position.set(0, PLAYER_HEIGHT, 0);
    velocity.set(0, 0, 0);
    updateHealthUI();
    updateKillsUI();
    for (const bot of bots) respawnBot(bot);
}

function flashDamage() {
    const overlay = document.getElementById('damage-overlay');
    if (overlay) {
        overlay.style.opacity = '0.4';
        setTimeout(() => overlay.style.opacity = '0', 150);
    }
}

// ========================
// COLLISION
// ========================
function getFloorHeight(x, z) {
    let maxY = 0;
    const testBox = new THREE.Box3(
        new THREE.Vector3(x - PLAYER_RADIUS, 0, z - PLAYER_RADIUS),
        new THREE.Vector3(x + PLAYER_RADIUS, PLAYER_HEIGHT, z + PLAYER_RADIUS)
    );
    for (const seg of floorSegments) {
        if (testBox.intersectsBox(seg.box3)) {
            if (seg.topY > maxY) maxY = seg.topY;
        }
    }
    return maxY;
}

function checkWallCollision(newX, newZ, currentY) {
    const playerBox = new THREE.Box3(
        new THREE.Vector3(newX - PLAYER_RADIUS, currentY - PLAYER_HEIGHT, newZ - PLAYER_RADIUS),
        new THREE.Vector3(newX + PLAYER_RADIUS, currentY + 0.2, newZ + PLAYER_RADIUS)
    );

    for (const wall of colliders) {
        if (playerBox.intersectsBox(wall)) {
            // Check if this is a floor segment we can step on
            let isFloor = false;
            for (const seg of floorSegments) {
                if (seg.box3 === wall && seg.topY <= currentY + 0.6) {
                    isFloor = true;
                    break;
                }
            }
            if (!isFloor) return true; // blocked
        }
    }
    return false; // not blocked
}

// ========================
// UI
// ========================
function updateUI() {
    if (currentWeapon.isKnife) {
        document.getElementById('ammo-count').textContent = '∞';
    } else {
        document.getElementById('ammo-count').textContent = `${currentWeapon.ammo} / ${currentWeapon.maxAmmo}`;
    }
}

function updateHealthUI() {
    const fill = document.getElementById('health-fill');
    if (fill) fill.style.width = (playerHealth / PLAYER_MAX_HEALTH) * 100 + '%';
}

function updateKillsUI() {
    const el = document.getElementById('kills-count');
    if (el) el.textContent = `Kills: ${kills}`;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========================
// GAME LOOP
// ========================
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1); // cap delta

    if (controls.isLocked) {
        const speedMult = currentWeapon.isKnife ? KNIFE_SPEED_MULT : 1.0;
        const currentSpeed = MOVE_SPEED * speedMult;

        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        velocity.y -= GRAVITY * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        if (moveForward || moveBackward) velocity.z -= direction.z * currentSpeed * 10.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * currentSpeed * 10.0 * delta;

        // Calculate proposed new position
        const obj = controls.getObject();
        const oldX = obj.position.x;
        const oldZ = obj.position.z;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        const newX = obj.position.x;
        const newZ = obj.position.z;

        // Wall collision - try each axis independently
        if (checkWallCollision(newX, newZ, obj.position.y)) {
            // Try just X
            if (!checkWallCollision(newX, oldZ, obj.position.y)) {
                obj.position.z = oldZ;
            }
            // Try just Z
            else if (!checkWallCollision(oldX, newZ, obj.position.y)) {
                obj.position.x = oldX;
            }
            // Both blocked
            else {
                obj.position.x = oldX;
                obj.position.z = oldZ;
            }
        }

        // Arena boundary clamp (safety)
        obj.position.x = Math.max(-ARENA_SIZE + 1, Math.min(ARENA_SIZE - 1, obj.position.x));
        obj.position.z = Math.max(-ARENA_SIZE + 1, Math.min(ARENA_SIZE - 1, obj.position.z));

        // Vertical movement + floor/stairs
        obj.position.y += velocity.y * delta;

        const floorY = getFloorHeight(obj.position.x, obj.position.z);
        const minY = floorY + PLAYER_HEIGHT;

        if (obj.position.y < minY) {
            velocity.y = 0;
            obj.position.y = minY;
            canJump = true;
        }

        // Ceiling
        if (obj.position.y > CEILING_HEIGHT - 0.5) {
            obj.position.y = CEILING_HEIGHT - 0.5;
            velocity.y = 0;
        }

        // Weapon sway
        if (weaponGroup) {
            const swayAmount = 0.002;
            weaponGroup.position.x += Math.sin(time * 0.003) * swayAmount;
            weaponGroup.position.y += Math.cos(time * 0.004) * swayAmount * 0.5;
        }

        updateBots(delta, time);
    }

    renderer.render(scene, camera);
    prevTime = time;
}
