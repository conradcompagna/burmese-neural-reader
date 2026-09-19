# Training infrastructure

| Path | Role |
|---|---|
| `corpus/` | CoNLL-U/DocBin conversion, constituency-to-dependency conversion, chunking, and segmentation evaluation |
| `boundaries/` | Sentence, particle, and OCR-structure CRF training and prediction |
| `configs/` | Named spaCy parser, entity, phrase, boundary, and pretraining architectures |
| `deployed_spacy_config.cfg` | Deployed parser architecture with portable input placeholders |
| `requirements.txt` | Additional training and research dependencies |

Run package-based tools from the repository root with `python -m training.<area>.<module>`. Each workflow expects its own prepared corpus. Configuration paths under `data/` and `models/` are placeholders for your resources; override `[paths]` entries for the selected training run. No weights, DocBins, frequency lists, or corpus exports are included.
