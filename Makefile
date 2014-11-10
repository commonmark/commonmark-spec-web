SPECVERSION=$(shell grep version: ../spec.txt | sed -e 's/version: *//')

update: dingus.html js/commonmark.js index.html $(SPECVERSION)/index.html js/LICENSE

upload:
	git pull; git commit -a -m "Updated site for latest spec, js" ; git push ; git push --tags

index.html: ../spec.txt
	./make_site_index.sh $(SPECVERSION) | \
	  pandoc --template ../template.html -S -s -t html5 -o $@

$(SPECVERSION)/index.html: spec.html spec.txt
	mkdir -p $(SPECVERSION) ; \
	cp $< $@ ; \
	cp spec.txt $(SPECVERSION)/spec.txt; \
	git add $(SPECVERSION)/index.html $(SPECVERSION)/spec.txt; git commit -a -m "Added version $(SPECVERSION) of spec"; \
	git tag $(SPECVERSION) HEAD

%: ../%
	cp $< $@
