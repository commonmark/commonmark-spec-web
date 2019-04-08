MAINREPO?=../commonmark-spec
JSREPO?=../commonmark.js
OLDSPECVERSION:=$(shell head -1 changelog.txt | sed -e 's/[^0-9.]//g')
SPECVERSION=$(shell grep version: $(MAINREPO)/spec.txt | sed -e 's/version: *//')

all: update
	echo "Spec version = $(SPECVERSION)"
	echo "Old spec version = $(OLDSPECVERSION)"
	git tag --list | grep -q -v $(SPECVERSION) ; \
	mkdir -p $(SPECVERSION) ; \
	make -C $(MAINREPO) spec.html ; \
	cp $(MAINREPO)/spec.html $(SPECVERSION)/index.html; \
	cp $(MAINREPO)/spec.txt $(SPECVERSION)/spec.txt; \
	python3 $(MAINREPO)/test/spec_tests.py \
	  --spec $(SPECVERSION)/spec.txt \
	  --dump-tests > $(SPECVERSION)/spec.json; \
	cp $(SPECVERSION)/index.html spec.html; \
	./make_site_index.sh $(OLDSPECVERSION) $(SPECVERSION) | \
	  pandoc --template template.html -s -t html5 -o index.html ; \
	git add spec.html $(SPECVERSION)/index.html $(SPECVERSION)/changes.html $(SPECVERSION)/spec.txt $(SPECVERSION)/spec.json ; \
	sed -e "s/VERSION/$(SPECVERSION)/g" current/index.html.in > current/index.html ; \
	git commit -a -m "Updated to version $(SPECVERSION) of spec"; \
	git tag $(SPECVERSION) HEAD

update:
	make -C $(JSREPO)/dingus ; \
	cp -r $(JSREPO)/dingus . ; \
	cp $(JSREPO)/dist/commonmark.js js/commonmark.js; \
	cp $(JSREPO)/LICENSE js/LICENSE; \
	cp $(MAINREPO)/changelog.txt changelog.txt; \

upload:
	git pull; git push; git push --tags

