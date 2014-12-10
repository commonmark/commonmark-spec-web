SPECVERSION=$(shell grep version: ../spec.txt | sed -e 's/version: *//')
COMMONMARKREPO=..

update: dingus.html js/commonmark.js $(SPECVERSION)/index.html index.html js/LICENSE

upload:
	git pull; git commit -a -m "Updated site for latest spec, js" ; git push ; git push --tags

index.html: $(COMMONMARKREPO)/spec.txt
	./make_site_index.sh $(SPECVERSION) | \
	  pandoc --template $(COMMONMARKREPO)/template.html -S -s -t html5 -o $@

$(SPECVERSION)/index.html: $(COMMONMARKREPO)/spec.txt $(COMMONMARKREPO)/spec.html
	git tag --list | grep $(SPECVERSION) || \
	  (echo "Version is already tagged." && exit 1; \
	mkdir -p $(SPECVERSION) ; \
	cp $(COMMONMARKREPO)/spec.html $@ ; \
	cp $(COMMONMARKREPO)/spec.txt $(SPECVERSION)/spec.txt; \
	rm spec.html; \
	cp $(SPECVERSION)/index.html spec.html; \
	git add spec.html $(SPECVERSION)/index.html $(SPECVERSION)/changes.html $(SPECVERSION)/spec.txt; git commit -a -m "Added version $(SPECVERSION) of spec"; \
	git tag $(SPECVERSION) HEAD

js/commonmark.js: $(COMMONMARKREPO)/js/commonmark.js
	cp $< $@

%: $(COMMONMARKREPO)/%
	cp $< $@
