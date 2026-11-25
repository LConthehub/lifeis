// THE ONE PLACE THE OWNER'S ARTWORK IS LISTED. Nothing has been added yet, and every slot with no file shows nothing
// (or, for the stripe, plain flat bands). To add a picture: put the file in frontend/public/art/ and write its name below.
// No page needs editing. The website's build reads this list too and copies the files it names.
//   mark    square, about 48 x 48 or larger: beside "Life is" in the header, and the Look choices
//   signin  wide, about 120 x 48 or larger: centred at the top of the sign-in card
//   empty   square, about 96 x 96 or larger: above the words of a page with nothing on it yet
//   wave    the hand-made wavy stripe: a wide PNG about 16 px tall at 1x (32 at 2x) that tiles left to right; it is
//           repeated across the header's stripe, the sign-in card's top and the website's bands
//   waveEdge  the same stripe made to tile top to bottom, for the side of a page (not used yet)
//
// THE PRINTOUTS (the stripe band, the mushroom and the recipe card frame). The owner's three files go in frontend/public/art/
// under the names in private/art-spec.html. Each replaces its stand-in on every printout with no other change:
//   stripe     stripe.svg      one repeat (about 4 in wide) of the wavy stripe; tiled across the top of each printout, 3/8 in tall.
//                              Stand-in: five flat bands (plum, green, gold, orange, cream).
//   mushroom   mushroom.svg    a square mushroom: 1/2 in at the top of each printout, 1 in on the zine's cover. If it has no heart
//                              behind it, the heart is not drawn. Stand-in: the app's own mushroom on a heart (mark-tan-192.png).
//   cardFrame  card-frame.svg  the 6 x 4 in recipe card frame (art in the outer 1/2 in, words in the middle), smaller around the
//                              title on the full recipe page. Stand-in: a thin line border inset 1/4 in. Left off in the plain styles.
export const ART = { mark: null, signin: null, empty: null, wave: null, waveEdge: null, stripe: null, mushroom: null, cardFrame: null };
