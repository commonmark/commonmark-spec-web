MAINREPO?=../CommonMark
JSREPO?=../commonmark.js
SPECVERSION=$(shell grep version: $(MAINREPO)/spec.txt | sed -e 's/version: *//')

all: update
	git tag --list | grep -q -v $(SPECVERSION) ; \
	mkdir -p $(SPECVERSION) ; \
	make -C $(MAINREPO) spec.html ; \
	cp $(MAINREPO)/spec.html $(SPECVERSION)/index.html; \
	cp $(MAINREPO)/spec.txt $(SPECVERSION)/spec.txt; \
	cp $(SPECVERSION)/index.html spec.html; \
	./make_site_index.sh $(SPECVERSION) | \
	  pandoc --template template.html -S -s -t html5 -o index.html ; \
	git add spec.html $(SPECVERSION)/index.html $(SPECVERSION)/changes.html $(SPECVERSION)/spec.txt ; \
	git commit -a -m "Updated to version $(SPECVERSION) of spec"; \
	git tag $(SPECVERSION) HEAD

update:
	sed -e 's/dist\/commonmark/js\/commonmark/g' $(JSREPO)/dingus.html > dingus.html; \
	cp $(JSREPO)/dingus.js dingus.js; \
	cp $(JSREPO)/dist/commonmark.js js/commonmark.js; \
	cp $(JSREPO)/LICENSE js/LICENSE; \
	cp $(MAINREPO)/changelog.txt changelog.txt; \

upload:
	git pull; git push; git push --tags

