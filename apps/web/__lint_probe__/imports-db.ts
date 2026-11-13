// SENGAJA MELANGGAR. Jangan diperbaiki, jangan dipindah, jangan dihapus.
// Uji negatif P0-03: bila `npm run lint:boundary` tidak gagal, aturan batas
// modul di eslint.config.js bohong — dan repo-layout.md §3 tidak ditegakkan apa pun.
import { migrate } from "@kelindan/db";

export const pelanggaran = migrate;
