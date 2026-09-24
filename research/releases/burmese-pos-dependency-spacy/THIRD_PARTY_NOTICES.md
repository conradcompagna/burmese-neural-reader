# Third-party sources

## myUDTree

Zar Zar Hlaing, Ye Kyaw Thu, Thepchai Supnithi and P. Netisopakul.
myUDTree v1.0: Myanmar Universal Dependencies treebank.
https://github.com/ye-kyaw-thu/myUDTree
Corpus license: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.
https://github.com/ye-kyaw-thu/myUDTree/blob/main/LICENSE.md
I converted the retained annotations to grouped spaCy documents, partitioned
them for training/development and trained the released joint pipeline.
The source corpus and DocBins are not bundled in this release.

## fastText word vectors

Edouard Grave, Piotr Bojanowski, Prakhar Gupta, Armand Joulin and Tomas Mikolov.
*Learning Word Vectors for 157 Languages.* LREC 2018.
https://fasttext.cc/docs/en/crawl-vectors
Burmese Common Crawl/Wikipedia vectors (cc.my.300):
Creative Commons Attribution-ShareAlike 3.0 Unported.
https://creativecommons.org/licenses/by-sa/3.0/
I converted the vectors to a spaCy vocabulary and retained 200,000 float32 rows.
The bundled vectors and their derived vocabulary remain subject to these terms;
they are not covered by fastText's separate MIT software license.

## spaCy

Explosion and spaCy contributors. https://spacy.io/ — MIT-licensed software,
installed separately. The released model uses spaCy 3.8.11's native format.
