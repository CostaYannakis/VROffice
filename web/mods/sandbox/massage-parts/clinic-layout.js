// Where the clinic sits in the Sandbox (office space, metres): its own room in the east wing, away from the desks.
// The door is in its west wall, facing the office. The south part is the reception and waiting area; a low planter
// divider (with a wide gap) separates it from the treatment area at the north end, where the table stands.
export const CLINIC = { minX: 4.8, maxX: 9.1, minZ: -5.6, maxZ: 1.6, wall: 2.6, door: [-.55, .95], split: -1.4, gap: [6.2, 8.0] };
// The massage table's centre; its long side (your side) faces +z, towards the reception.
export const TABLE = { x: 7.0, z: -3.3 };
export const inClinic = (x, z) => x > CLINIC.minX && x < CLINIC.maxX && z > CLINIC.minZ && z < CLINIC.maxZ;
