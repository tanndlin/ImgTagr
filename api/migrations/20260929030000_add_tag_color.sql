ALTER TABLE tags ADD COLUMN color TEXT NOT NULL DEFAULT (ARRAY[
    '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb', '#64b5f6', '#4dd0e1',
    '#4db6ac', '#81c784', '#aed581', '#dce775', '#ffd54f', '#ffb74d', '#a1887f'
])[floor(random() * 14)::int + 1];
