import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- CONFIGURATION ---
const GRAVITY = 15;
const JUMP_FORCE = 10;
const MOVE_SPEED = 7;
const SPRINT_MULTIPLIER = 1.6;

// --- GAME STATE ---
let camera, scene, renderer, controls;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, canJump = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();

// Weapons
const weapons = {
    pistol: { name: 'Pistola', damage: 20, fireRate: 400, ammo: 12, maxAmmo: 12, color: 0x888888 },
    smg: { name: 'Submetralhadora', damage: 10, fireRate: 100, ammo: 30, maxAmmo: 30, color: 0x444444 },
    sniper: { name: 'Rifle de Precisão', damage: 100, fireRate: 1500, ammo: 5, maxAmmo: 5, color: 0x222222 }
};
let currentWeapon = weapons.pistol;
let lastFireTime = 0;

// Initialize
init();
animate();

function init() {
    // Scene & Camera
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.FogExp2(0x050505, 0.02);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = 1.6; // Player height

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(10, 20, 10);
    sunLight.castShadow = true;
    scene.add(sunLight);

    // Controls
    controls = new PointerLockControls(camera, document.body);

    const instructions = document.getElementById('instructions');
    instructions.addEventListener('click', () => {
        controls.lock();
    });

    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
    });

    controls.addEventListener('unlock', () => {
        instructions.style.display = 'block';
    });

    scene.add(controls.getObject());

    // Input
    const onKeyDown = (event) => {
        switch (event.code) {
            case 'KeyW': moveForward = true; break;
            case 'KeyA': moveLeft = true; break;
            case 'KeyS': moveBackward = true; break;
            case 'KeyD': moveRight = true; break;
            case 'Space': if (canJump) velocity.y += JUMP_FORCE; canJump = false; break;
            case 'Digit1': switchWeapon('pistol'); break;
            case 'Digit2': switchWeapon('smg'); break;
            case 'Digit3': switchWeapon('sniper'); break;
        }
    };

    const onKeyUp = (event) => {
        switch (event.code) {
            case 'KeyW': moveForward = false; break;
            case 'KeyA': moveLeft = false; break;
            case 'KeyS': moveBackward = false; break;
            case 'KeyD': moveRight = false; break;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', (e) => {
        if (controls.isLocked && e.button === 0) fire();
    });

    // World / Arena
    createArena();

    // Weapon Mesh (Visual placeholder)
    createWeaponMesh();

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);
}

function createArena() {
    // Floor
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Walls
    const wallMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
    const createWall = (w, h, d, x, y, z) => {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
    };

    // Boundary Walls
    createWall(100, 10, 2, 0, 5, 50);
    createWall(100, 10, 2, 0, 5, -50);
    createWall(2, 10, 100, 50, 5, 0);
    createWall(2, 10, 100, -50, 5, 0);

    // Center Pit (Pool Day style)
    const pitGeo = new THREE.PlaneGeometry(20, 20);
    const pitMat = new THREE.MeshPhongMaterial({ color: 0x0055ff, transparent: true, opacity: 0.6 });
    const pit = new THREE.Mesh(pitGeo, pitMat);
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = 0.01;
    scene.add(pit);

    // Boxes / Obstacles
    const boxMat = new THREE.MeshPhongMaterial({ color: 0x555555 });
    for (let i = 0; i < 20; i++) {
        const size = 1 + Math.random() * 2;
        const boxGeo = new THREE.BoxGeometry(size, size, size);
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(
            (Math.random() - 0.5) * 80,
            size / 2,
            (Math.random() - 0.5) * 80
        );
        box.castShadow = true;
        box.receiveShadow = true;
        scene.add(box);
    }
}

let weaponMesh;
function createWeaponMesh() {
    const geo = new THREE.BoxGeometry(0.1, 0.1, 0.4);
    const mat = new THREE.MeshPhongMaterial({ color: 0x888888 });
    weaponMesh = new THREE.Mesh(geo, mat);
    weaponMesh.position.set(0.3, -0.3, -0.5);
    camera.add(weaponMesh);
}

function switchWeapon(type) {
    currentWeapon = weapons[type];
    weaponMesh.material.color.setHex(currentWeapon.color);
    document.getElementById('weapon-info').textContent = currentWeapon.name;
    updateUI();
}

function fire() {
    const now = performance.now();
    if (now - lastFireTime < currentWeapon.fireRate) return;
    if (currentWeapon.ammo <= 0) {
        // Simple reload logic
        setTimeout(() => {
            currentWeapon.ammo = currentWeapon.maxAmmo;
            updateUI();
        }, 1000);
        return;
    }

    lastFireTime = now;
    currentWeapon.ammo--;
    updateUI();

    // Muzzle Flash
    const flash = new THREE.PointLight(0xffaa00, 5, 2);
    flash.position.set(0.3, -0.3, -0.7);
    camera.add(flash);
    setTimeout(() => camera.remove(flash), 50);

    // Recoil
    weaponMesh.position.z += 0.05;
    setTimeout(() => weaponMesh.position.z -= 0.05, 50);

    // Hitscan
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(scene.children);

    if (intersects.length > 0) {
        const hit = intersects[0];
        createImpact(hit.point);
    }
}

function createImpact(point) {
    const geo = new THREE.SphereGeometry(0.05, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
    const impact = new THREE.Mesh(geo, mat);
    impact.position.copy(point);
    scene.add(impact);
    setTimeout(() => scene.remove(impact), 100);
}

function updateUI() {
    document.getElementById('ammo-count').textContent = `${currentWeapon.ammo} / ${currentWeapon.maxAmmo}`;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    if (controls.isLocked) {
        const time = performance.now();
        const delta = (time - prevTime) / 1000;

        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        velocity.y -= GRAVITY * delta; // Gravity

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        if (moveForward || moveBackward) velocity.z -= direction.z * MOVE_SPEED * 10.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * MOVE_SPEED * 10.0 * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        controls.getObject().position.y += (velocity.y * delta);

        if (controls.getObject().position.y < 1.6) {
            velocity.y = 0;
            controls.getObject().position.y = 1.6;
            canJump = true;
        }

        prevTime = time;
    }

    renderer.render(scene, camera);
}
