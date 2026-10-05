LABELS FOR THE 3D POUCH (the viewer under "Fun Fact About Me")
================================================================

Each label is ONE image:

  - Size:    2048 x 1536 px  (PNG or JPG)
  - Layout:  LEFT half  (1024 x 1536) = FRONT of the pouch
             RIGHT half (1024 x 1536) = BACK of the pouch
  - Top:     the top 10% of each half sits on the flat heat-seal strip.
  - Safe area: keep text and logos about 100 px in from every edge of
             each half (the dashed line on the template art). The sides
             of the pouch curve away, so anything right at the edge is
             hard to read.

label-01.png, label-02.png and label-03.png are placeholder template art.

TO REPLACE A DESIGN
  Save your art over label-01.png (same size, same name). Done.

TO ADD OR REMOVE A DESIGN
  1. Put the image in this folder.
  2. Open labels.json and add (or delete) a line like:
       { "name": "My Coffee Pouch", "image": "assets/labels/my-coffee.png" },
     "name" is the caption shown under the pouch. The order in the file is
     the order of the arrows. The last line has no comma at the end.

BOTTOM OF THE POUCH (optional)
  A label can have its own image for the base of the pouch - a pattern or
  texture, like label-01-bottom.png. Put the image in this folder and add
  "bottom" to that label's line in labels.json:
       { "name": "My Coffee Pouch", "image": "assets/labels/my-coffee.png", "bottom": "assets/labels/my-coffee-bottom.png" },
  - The image is laid flat on the base, centred, at its own proportions,
    with its full width running across the pouch from side to side.
  - The base is a long, narrow oval, so only a band through the middle of
    the image shows. A repeating pattern works best.
  - Size: about 2048 px wide is plenty (PNG or JPG). Bigger files only
    load slower; they don't look sharper.
  - Labels with no "bottom" get a plain base in the colour of the bottom
    edge of the label.

Nothing else needs to change. If only one label is listed, the arrows hide.
