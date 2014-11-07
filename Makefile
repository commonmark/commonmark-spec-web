SPECVERSION=$(shell grep version: ../spec.txt | sed -e 's/version: *//')

update: dingus.html js/commonmark.js index.html $(SPECVERSION)/index.html js/LICENSE

upload:
	git pull; git commit -a -m "Updated site for latest spec, js" ; git push

index.html: ../spec.txt
	./make_site_index.sh $(SPECVERSION) | \
	  pandoc --template ../template.html -S -s -t html5 -o $@

$(SPECVERSION)/index.html: spec.html
	mkdir -p $(SPECVERSION) ; \
	cp $< $@ ; \
	git add $(SPECVERSION)/index.html; git commit -a -m "Added version $(SPECVERSION) of spec"; cd ..

%: ../%
	cp $< $@
