MAINREPO?=../CommonMark
JSREPO?=../commonmark.js
SPECVERSION=$(shell grep version: $(MAINREPO)/spec.txt | sed -e 's/version: *//')

all: update current/index.html
	git tag --list | grep -q -v $(SPECVERSION) ; \
	mkdir -p $(SPECVERSION) ; \
	make -C $(MAINREPO) spec.html ; \
	cp $(MAINREPO)/spec.html $(SPECVERSION)/index.html; \
	cp $(MAINREPO)/spec.txt $(SPECVERSION)/spec.txt; \
	cp $(SPECVERSION)/index.html spec.html; \
	./make_site_index.sh $(SPECVERSION) | \
	  pandoc --template template.html -S -s -t html5 -o index.html ; \
	git add spec.html $(SPECVERSION)/index.html $(SPECVERSION)/changes.html $(SPECVERSION)/spec.txt ; \
	rm latest; \
	ln -s $(SPECVERSION) latest; \
	git commit -a -m "Updated to version $(SPECVERSION) of spec"; \
	git tag $(SPECVERSION) HEAD

current/index.html: current/index.html.in
	sed -e "s/VERSION/$(SPECVERSION)/g" $< > $@

update:
	make -C $(JSREPO)/dingus ; \
	cp -r $(JSREPO)/dingus . ; \
	cp $(JSREPO)/dist/commonmark.js js/commonmark.js; \
	cp $(JSREPO)/LICENSE js/LICENSE; \
	cp $(MAINREPO)/changelog.txt changelog.txt; \

upload:
	git pull; git push; git push --tags

