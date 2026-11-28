/** A project's pictures: ideas to aim for and the person's own work, kept here or linked from a photo library. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { MAX_PROJECT_PICTURES, projects, type Projects } from '../src/projects.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let mine: Projects;
let theirs: Projects;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const PNG = (n: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 2, 3, 4]);
const ASSET = '8a5c3e5e-1c2d-4c7e-9b1a-2f3d4e5f6a7b';

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  const a = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('ana', 'x', 'now')")).lastId;
  const b = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('bob', 'x', 'now')")).lastId;
  mine = projects(db, a, clock);
  theirs = projects(db, b, clock);
});

it('keeps pictures as ideas or its own work, in order, with captions', async () => {
  const p = await mine.createProject({ name: 'Bookshelf' });
  expect(p.pictures).toEqual([]);
  await mine.keepPicture(p.id, PNG(1), 'idea', ' Oak shelves ');
  await mine.keepPicture(p.id, PNG(2), 'idea');
  const whole = await mine.keepPicture(p.id, PNG(3), 'mine', 'My first shelf');
  expect(whole.pictures.map((x) => [x.kind, x.caption, x.source])).toEqual([['idea', 'Oak shelves', 'kept'], ['idea', null, 'kept'], ['mine', 'My first shelf', 'kept']]);
  expect(whole.pictures_count).toBe(3);
  expect(await mine.picture(whole.pictures[0]!.id)).toMatchObject({ source: 'kept', type: 'image/png' });
});

it('refuses what is not a picture, too large a picture, and a kind that is neither idea nor mine', async () => {
  const p = await mine.createProject({ name: 'Bookshelf' });
  await expect(mine.keepPicture(p.id, new TextEncoder().encode('just words'), 'idea')).rejects.toEqual(problem(400));
  await expect(mine.keepPicture(p.id, new Uint8Array([...PNG(1), ...new Uint8Array(3_000_001)]), 'idea')).rejects.toEqual(problem(400));
  await expect(mine.keepPicture(p.id, PNG(1), 'other')).rejects.toEqual(problem(400));
  await expect(mine.keepPicture(p.id, PNG(1), null)).rejects.toEqual(problem(400));
  expect((await mine.getProject(p.id)).pictures).toEqual([]);
});

it('holds 80 pictures at most', async () => {
  const p = await mine.createProject({ name: 'Bookshelf' });
  for (let n = 0; n < MAX_PROJECT_PICTURES; n += 1) await db.run("INSERT INTO project_pictures (project_id, source, kind, type, bytes, sort_order, created_at) VALUES (?, 'kept', 'idea', 'image/png', ?, ?, 'now')", [p.id, PNG(1), n + 1]);
  await expect(mine.keepPicture(p.id, PNG(9), 'idea')).rejects.toEqual(problem(400));
  await expect(mine.linkPicture(p.id, ASSET, 'idea')).rejects.toEqual(problem(400));
});

it('links a picture from a photo library by which one it is, once', async () => {
  const p = await mine.createProject({ name: 'Bookshelf' });
  await mine.linkPicture(p.id, ASSET, 'mine', 'From Immich');
  const whole = await mine.linkPicture(p.id, ASSET, 'mine');
  expect(whole.pictures).toHaveLength(1);
  expect(await mine.picture(whole.pictures[0]!.id)).toEqual({ source: 'immich', asset_id: ASSET });
  await expect(mine.linkPicture(p.id, 'not a photo!', 'idea')).rejects.toEqual(problem(400));
});

it('changes a caption and idea or mine, and a field left out stays', async () => {
  const p = await mine.createProject({ name: 'Bookshelf' });
  const id = (await mine.keepPicture(p.id, PNG(1), 'idea', 'First')).pictures[0]!.id;
  expect((await mine.updatePicture(id, { kind: 'mine' })).pictures[0]).toMatchObject({ kind: 'mine', caption: 'First' });
  expect((await mine.updatePicture(id, { caption: 'Second' })).pictures[0]).toMatchObject({ kind: 'mine', caption: 'Second' });
  expect((await mine.updatePicture(id, { caption: null })).pictures[0]!.caption).toBeNull();
  await expect(mine.updatePicture(id, { kind: 'both' })).rejects.toEqual(problem(400));
});

it('takes a picture off, and removes them with the project', async () => {
  const p = await mine.createProject({ name: 'Bookshelf' });
  const id = (await mine.keepPicture(p.id, PNG(1), 'idea')).pictures[0]!.id;
  await mine.keepPicture(p.id, PNG(2), 'idea');
  expect((await mine.removePicture(id)).pictures).toHaveLength(1);
  await expect(mine.picture(id)).rejects.toEqual(problem(404));
  await mine.deleteProject(p.id);
  expect(await db.get('SELECT 1 FROM project_pictures')).toBeUndefined();
});

it('shows only a person their own project pictures', async () => {
  const p = await mine.createProject({ name: 'Bookshelf' });
  const id = (await mine.keepPicture(p.id, PNG(1), 'idea')).pictures[0]!.id;
  await expect(theirs.picture(id)).rejects.toEqual(problem(404));
  await expect(theirs.updatePicture(id, { caption: 'x' })).rejects.toEqual(problem(404));
  await expect(theirs.removePicture(id)).rejects.toEqual(problem(404));
  await expect(theirs.keepPicture(p.id, PNG(2), 'idea')).rejects.toEqual(problem(404));
  await expect(theirs.linkPicture(p.id, ASSET, 'idea')).rejects.toEqual(problem(404));
});

it('a finished project covers itself with its first Mine picture; others have no cover', async () => {
  const p = await mine.createProject({ name: 'Bookshelf', status: 'active' });
  await mine.keepPicture(p.id, PNG(1), 'idea');
  const first = (await mine.keepPicture(p.id, PNG(2), 'mine')).pictures[1]!;
  await mine.keepPicture(p.id, PNG(3), 'mine');
  expect((await mine.getProject(p.id)).cover_picture).toBeNull();
  await mine.updateProject(p.id, { name: 'Bookshelf', status: 'done' });
  expect((await mine.getProject(p.id)).cover_picture).toBe(first.id);
  const listed = (await mine.listProjects()).find((x) => x.id === p.id)!;
  expect(listed).toMatchObject({ cover_picture: first.id, pictures_count: 3 });
  expect(listed).not.toHaveProperty('pictures');
  const ideas = await mine.createProject({ name: 'Birdhouse', status: 'done' });
  await mine.keepPicture(ideas.id, PNG(4), 'idea');
  expect((await mine.getProject(ideas.id)).cover_picture).toBeNull();
});
