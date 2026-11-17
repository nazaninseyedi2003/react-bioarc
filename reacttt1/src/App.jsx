import React, {useEffect, useLayoutEffect, useState} from 'react';
import {AppProvider} from './state';
import {PageTemplate} from './templates/original';
import {hasClass, patch, renderTree} from './lib';
import Sidebar from './components/Sidebar';
import Activities from './components/Activities';
import SearchAndTooltips from './components/SearchAndTooltips';

function RecordPage() {
  const [collapsed, setCollapsed] = useState({});
  useLayoutEffect(() => {
    const notice = document.querySelector('.description');
    const summary = document.querySelector('.file-details2');
    const column = document.querySelector('.file-details-main');
    if (!notice || !summary || !column) return;
    const parent = notice.parentElement;
    const alignNotice = () => {
      const reference = summary.getBoundingClientRect().width ? summary : column;
      const box = reference.getBoundingClientRect();
      const outer = parent.getBoundingClientRect();
      const style = getComputedStyle(parent);
      const left = outer.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const right = outer.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      notice.style.width = box.width + 'px';
      notice.style.maxWidth = 'none';
      notice.style.marginLeft = Math.max(0, box.left - left) + 'px';
      notice.style.marginRight = Math.max(0, right - box.right) + 'px';
      const sidebar = document.querySelector('.sidebar');
      const layout = column.closest('.file-details');
      if (sidebar && layout) {
        const beside = getComputedStyle(layout).flexDirection === 'row';
        if (beside && window.innerWidth <= 1200) {
          // Match the desktop top alignment without a fixed notice height.
          sidebar.style.marginTop = (notice.getBoundingClientRect().top -
            column.getBoundingClientRect().top) + 'px';
        } else {
          sidebar.style.removeProperty('margin-top');
        }
      }
    };
    alignNotice();
    const observer = new ResizeObserver(alignNotice);
    [parent, column, summary, notice].forEach(element => observer.observe(element));
    window.addEventListener('resize', alignNotice);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', alignNotice);
    };
  }, []);

  useEffect(() => {
    const reveal = ({detail}) => {
      const target = detail?.element;
      if (!target) return;
      setCollapsed(previous => {
        const next = {...previous};
        document.querySelectorAll('[data-record-section]').forEach(section => {
          if (section.contains(target)) delete next[section.dataset.recordSection];
        });
        return next;
      });
    };
    window.addEventListener('bioarc:reveal', reveal);
    return () => window.removeEventListener('bioarc:reveal', reveal);
  }, []);
  let sectionIndex = 0;
  // Decorate the retained record JSX without changing its surrounding layout.
  function sections(node) {
    if (!React.isValidElement(node) || node.props.children == null) return node;
    const children = React.Children.toArray(node.props.children);
    const output = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (hasClass(child, 'file-details1')) {
        const id = String(sectionIndex++);
        const closed = !!collapsed[id];
        const toggle = () => setCollapsed(previous => ({...previous, [id]:!previous[id]}));
        output.push(patch(child, {className:child.props.className + (closed ? ' is-collapsed' : ''),role:'button',tabIndex:0,'aria-expanded':!closed,onClick:toggle,onKeyDown:event => {
          if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();toggle();}
        }}));
        while (i + 1 < children.length && !React.isValidElement(children[i + 1])) output.push(children[++i]);
        if (i + 1 < children.length) {
          const target = sections(children[++i]);
          output.push(React.isValidElement(target) ? patch(target, {'data-record-section':id,style:{...target.props.style,...(closed ? {display:'none'} : {})}}) : target);
        }
      } else output.push(sections(child));
    }
    return patch(node, {}, output);
  }
  const page = sections(PageTemplate({SidebarSlot:Sidebar,ActivitiesSlot:Activities}));
  return <>{renderTree(page, node => hasClass(node,'button-set') ? patch(node,{onClick:event => {
    document.dispatchEvent(new CustomEvent('settings:open',{detail:{button:event.currentTarget}}));
  }}) : hasClass(node, 'button-log') ? patch(node, {
    'aria-label': 'نمایش تاریخچه فعالیت‌ها',
    onClick: () => window.dispatchEvent(new CustomEvent('bioarc:show-logs'))
  }) : hasClass(node, 'button-view') ? patch(node, {'aria-label': 'مشاهده‌ها'}) : node)}<SearchAndTooltips /></>;
}

export default function App() { return <AppProvider><RecordPage /></AppProvider>; }
