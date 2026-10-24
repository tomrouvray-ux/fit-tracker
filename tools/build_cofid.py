"""Build data/foods-uk.json from McCance and Widdowson's CoFID spreadsheet.

Usage: python3 tools/build_cofid.py path/to/CoFID.xlsx
Source: https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid
Contains public sector information licensed under the Open Government Licence v3.0.
"""
import json
import sys

import openpyxl


def num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return 0  # 'Tr' (trace), 'N' (not measured) or blank


def rows(ws):
    it = ws.iter_rows(values_only=True)
    header = ('Food Code',) + tuple(next(it)[1:])  # one sheet leaves the code column header blank
    next(it), next(it)  # code row and long-name row
    for r in it:
        if r[0] and r[1]:
            yield dict(zip(header, r))


def main(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    sodium = {r['Food Code']: num(r.get('Sodium (mg)')) for r in rows(wb['1.4 Inorganics'])}
    foods = []
    for r in rows(wb['1.3 Proximates']):
        kcal = num(r.get('Energy (kcal) (kcal)'))
        if not kcal and not num(r.get('Protein (g)')):
            continue
        fib = num(r.get('AOAC fibre (g)')) or num(r.get('NSP (g)'))
        foods.append([
            r['Food Name'].strip(), kcal, num(r.get('Protein (g)')), num(r.get('Carbohydrate (g)')),
            num(r.get('Fat (g)')), fib, num(r.get('Total sugars (g)')), sodium.get(r['Food Code'], 0),
        ])
    foods.sort(key=lambda f: f[0].lower())
    out = {
        'source': "McCance and Widdowson's Composition of Foods Integrated Dataset (Public Health England), Open Government Licence v3.0",
        'fields': ['name', 'kcal', 'p', 'c', 'f', 'fib', 'sug', 'na'],
        'foods': foods,
    }
    with open('data/foods-uk.json', 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
    print(len(foods), 'foods')


if __name__ == '__main__':
    main(sys.argv[1])
