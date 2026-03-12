import { describe, it, expect } from "vitest";
import { parseBibtex, parseRis } from "../src/lib/bibtex-parser.js";

describe("parseBibtex", () => {
  it("parses a journal article", () => {
    const bibtex = `
@article{battelino2019,
  title = {Clinical Targets for CGM Data Interpretation},
  author = {Battelino, Tadej and Danne, Thomas},
  journal = {Diabetes Care},
  year = {2019},
  volume = {42},
  number = {8},
  pages = {1593--1603},
  doi = {10.2337/dc19-1028}
}
`;
    const entries = parseBibtex(bibtex);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Clinical Targets for CGM Data Interpretation");
    expect(entries[0].author).toHaveLength(2);
    expect(entries[0].author![0].family).toBe("Battelino");
    expect(entries[0].author![0].given).toBe("Tadej");
    expect(entries[0].volume).toBe("42");
    expect(entries[0].page).toBe("1593-1603");
    expect(entries[0].DOI).toBe("10.2337/dc19-1028");
    expect(entries[0].issued?.["date-parts"]?.[0]?.[0]).toBe(2019);
  });

  it("parses multiple entries", () => {
    const bibtex = `
@article{smith2020,
  title = {First Paper},
  author = {Smith, John},
  year = {2020}
}

@inproceedings{doe2021,
  title = {Second Paper},
  author = {Doe, Jane},
  year = {2021},
  booktitle = {Some Conference}
}
`;
    const entries = parseBibtex(bibtex);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("article-journal");
    expect(entries[1].type).toBe("paper-conference");
    expect(entries[1]["container-title"]).toBe("Some Conference");
  });

  it("handles empty input", () => {
    expect(parseBibtex("")).toHaveLength(0);
  });

  it("treats non-numeric year as undefined instead of NaN", () => {
    const bibtex = `
@article{broken2020,
  title = {Bad Year},
  author = {Test, Author},
  year = {in press}
}
`;
    const entries = parseBibtex(bibtex);
    expect(entries).toHaveLength(1);
    expect(entries[0].issued).toBeUndefined();
  });

  it("cleans LaTeX markup", () => {
    const bibtex = `
@article{test,
  title = {M\\"{u}ller's~analysis},
  author = {M\\"{u}ller, Hans},
  year = {2020}
}
`;
    const entries = parseBibtex(bibtex);
    expect(entries).toHaveLength(1);
    // Should have cleaned the LaTeX
    expect(entries[0].author![0].family).toBe("Muller");
  });
});

describe("parseRis", () => {
  it("parses a journal article", () => {
    const ris = `TY  - JOUR
AU  - Battelino, Tadej
AU  - Danne, Thomas
TI  - Clinical Targets for CGM Data
JO  - Diabetes Care
PY  - 2019
VL  - 42
IS  - 8
SP  - 1593
EP  - 1603
DO  - 10.2337/dc19-1028
ER  -
`;
    const entries = parseRis(ris);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Clinical Targets for CGM Data");
    expect(entries[0].author).toHaveLength(2);
    expect(entries[0].page).toBe("1593-1603");
    expect(entries[0].DOI).toBe("10.2337/dc19-1028");
  });

  it("parses multiple entries", () => {
    const ris = `TY  - JOUR
TI  - First
PY  - 2020
ER  -
TY  - BOOK
TI  - Second
PY  - 2021
ER  -
`;
    const entries = parseRis(ris);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("article-journal");
    expect(entries[1].type).toBe("book");
  });

  it("handles empty input", () => {
    expect(parseRis("")).toHaveLength(0);
  });

  it("treats non-numeric year as undefined instead of NaN", () => {
    const ris = `TY  - JOUR
TI  - Bad Year Paper
PY  - forthcoming
ER  -
`;
    const entries = parseRis(ris);
    expect(entries).toHaveLength(1);
    expect(entries[0].issued).toBeUndefined();
  });
});
