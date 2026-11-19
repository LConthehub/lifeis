/**
 * Something the person asked for can't be done, said in words meant for them ("Give the recipe a name").
 * `status` is the kind of problem, as the web knows them: 400 the request is wrong, 404 it isn't there,
 * 409 it clashes with what's already so. The server answers with it; the app shows the words.
 */
export class Problem extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = 'Problem';
  }
}
