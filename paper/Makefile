# Build both papers with tectonic (self-contained LaTeX).
# arxiv.pdf    — named preprint (NeurIPS 2026 preprint style)
# workshop.pdf — anonymized double-blind workshop submission
BODY = body.tex preamble.tex references.bib

all: arxiv.pdf workshop.pdf

arxiv.pdf: arxiv.tex $(BODY)
	tectonic arxiv.tex

workshop.pdf: workshop.tex $(BODY)
	tectonic workshop.tex

.PHONY: clean all
clean:
	rm -f *.aux *.bbl *.blg *.log *.out *.xdv
