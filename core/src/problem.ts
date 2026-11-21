/**
 * Something the person asked for can't be done, said in words meant for them ("Give the recipe a name").
 * `status` is the kind of problem, as the web knows them: 400 the request is wrong, 403 it isn't yours to do,
 * 404 it isn't there, 409 it clashes with what's already so, 422 a value can't be used (money below zero). The server answers with it; the app shows the words.
 */
export class Problem extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422;

  constructor(status: 400 | 403 | 404 | 409 | 422, message: string) {
    super(message);
    this.name = 'Problem';
    this.status = status;
  }
}
