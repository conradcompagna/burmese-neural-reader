import spacy, numpy as np, srsly

PIPE_PATH = r"C:\bilu_segmenter_model_v4\model-last"
PRETRAIN_BIN = r"C:\Users\conra\Desktop\burmese d\randomdata\spacynewpipeline\pt_chr_v3\model-last.bin"

nlp = spacy.load(PIPE_PATH)

tok_trained = nlp.get_pipe("tok2vec").model.copy()
tok_pre = tok_trained.copy()

tok_pre.from_bytes(srsly.read_bytes(PRETRAIN_BIN))

t = tok_trained.get_param_vector()
p = tok_pre.get_param_vector()

diff = np.abs(t - p)
print("same_shape:", t.shape == p.shape)
print("max_abs_diff:", float(diff.max()))
print("mean_abs_diff:", float(diff.mean()))
