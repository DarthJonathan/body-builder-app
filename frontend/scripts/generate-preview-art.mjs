import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('static/images');
fs.mkdirSync(path.join(root, 'muscles'), { recursive: true });
const defs = `<defs><linearGradient id="body" x1="0" x2="1"><stop stop-color="#faf8f1"/><stop offset=".35" stop-color="#9a9b97"/><stop offset=".6" stop-color="#edece7"/><stop offset="1" stop-color="#777e7d"/></linearGradient><linearGradient id="red" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff7047"/><stop offset=".55" stop-color="#ce4226"/><stop offset="1" stop-color="#8f281b"/></linearGradient></defs>`;
const shape = `<g fill="url(#body)" stroke="#6a716e" stroke-width=".7"><path d="M40 18 34 27 21 30 16 42 9 75 8 111 15 115 22 82 28 62 29 94 24 128 28 174 43 174 46 125 53 125 57 174 72 174 76 128 70 94 72 62 79 82 86 115 93 111 91 75 84 42 79 30 66 27 60 18Z"/><path d="M41 0Q33 5 36 16L42 24H59L66 16Q69 4 60 0Z"/><path d="M41 25 49 32 59 25M30 42 47 52 51 92 55 52 71 42M29 96 50 105 71 96M25 124 46 125M54 125 75 124M31 141 40 174M61 174 70 141" fill="none"/></g>`;
const areas = {
  shoulders: `<path d="M31 30Q21 30 18 43L26 55 35 45Z M69 30Q80 30 83 43L75 55 65 45Z"/>`,
  chest: `<path d="M34 32 47 36 49 53 32 50 27 43Z M66 32 53 36 51 53 68 50 73 43Z"/>`,
  biceps: `<path d="M24 48 17 73 18 88 27 64 29 54Z M76 48 83 73 82 88 73 64 71 54Z"/>`,
  triceps: `<path d="M21 48 14 75 17 87 24 69 27 51Z M79 48 86 75 83 87 76 69 73 51Z"/>`,
  core: `<path d="M38 58 48 56 48 65 38 67Z M52 56 62 58 62 67 52 65Z M38 70 48 68 48 79 38 81Z M52 68 62 70 62 81 52 79Z M38 84 48 82 48 96 40 100Z M52 82 62 84 60 100 52 96Z"/>`,
  back: `<path d="M35 28 48 35 45 60 30 47 23 39Z M65 28 52 35 55 60 70 47 77 39Z M31 49 46 64 49 92 37 97 29 71Z M69 49 54 64 51 92 63 97 71 71Z"/>`,
  glutes: `<path d="M28 91Q38 86 47 97L47 117Q34 128 26 116Z M72 91Q62 86 53 97L53 117Q66 128 74 116Z"/>`,
  quadriceps: `<path d="M27 116 43 119 43 150 36 167 29 143Z M73 116 57 119 57 150 64 167 71 143Z"/>`,
  hamstrings: `<path d="M28 120 44 126 39 158 32 171 28 146Z M72 120 56 126 61 158 68 171 72 146Z"/>`,
  calves: `<path d="M31 139Q38 135 42 147L39 170 32 174 28 158Z M69 139Q62 135 58 147L61 170 68 174 72 158Z"/>`
};
for (const [id, area] of Object.entries(areas)) {
  fs.writeFileSync(path.join(root, 'muscles', `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 178">${defs}${shape}<g fill="url(#red)" stroke="#f7a17c" stroke-width=".5">${area}</g></svg>`);
}
fs.writeFileSync(path.join(root, 'exercise-placeholder.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="13" fill="#f7f7f5"/><g fill="none" stroke="#314b6e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="m29 47 44 27M23 56l12-20M16 51l12-20M72 83l12-20M80 88l12-20"/></g></svg>`);
fs.writeFileSync(path.join(root, 'hero.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 260"><defs><linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ecc4a3"/><stop offset="1" stop-color="#bd8168"/></linearGradient></defs><g><path d="M113 43Q99 17 130 13L154 19 165 47 146 60Z" fill="#886043"/><circle cx="149" cy="18" r="16" fill="#7e583f"/><path d="M111 33 138 31 151 45 142 67 124 70 111 56Z" fill="url(#skin)"/><path d="M122 67 147 62 168 103 157 153 193 218 153 253 97 189 92 134Z" fill="#171f24"/><path d="m151 72 26 19 21 61-17 10-36-40-12-24Z" fill="url(#skin)"/><path d="M145 109 137 135 96 143 91 129 124 116Z" fill="url(#skin)"/><path d="M97 84 116 90 113 104 95 107 77 95 78 78Z" fill="url(#skin)"/><path d="M118 80 137 84 131 110 114 110Z" fill="url(#skin)"/><g fill="#465259" stroke="#222e34" stroke-width="2"><rect x="80" y="60" width="54" height="20" rx="6" transform="rotate(9 107 70)"/><rect x="98" y="106" width="57" height="23" rx="6" transform="rotate(9 126 117)"/><rect x="110" y="77" width="11" height="34" rx="3"/></g><path d="m96 157 54 44-55 17-57 35H-3L30 202Z" fill="#2c353b"/><path d="m149 172 40 33 31 48h-59l-40-38Z" fill="#323c41"/></g></svg>`);
console.log('Generated ten muscle illustrations, hero, and exercise fallback.');
